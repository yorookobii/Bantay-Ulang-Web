"""
Bantay Ulang — RF Yield Prediction (Batch Inference)
=====================================================
Kumukuha ng water parameters mula Firestore (collection group query sa
"readings" — HistoryLogs/Ulang/years/reading_YYYY/reading_MM/reading_DD/readings),
ini-average, pinapakain sa trained Random Forest, nag-pro-project ng harvest
weight, at isinusulat ang yield prediction pabalik sa growth_indicators.

DATA MODE (auto-detected sa rfMode):
  - Water parameters: TOTOO mula Firestore (temp, pH, DO, tds, turbidity)
  - currentWeight: TOTOO mula ulang_growth_records kung may sample na para
    sa cycle; kung wala pa, ASSUMED (2.0g juvenile start) — graceful fallback
  - feedRate: ASSUMED pa rin (optimal_feed_rate curve) — hiwalay na phase

READ GUARDRAIL:
  - Nagta-track ng Firestore reads kada araw (local JSON file)
  - Nag-wa-warning bago maabot ang free tier limit (50,000 reads/araw)

HYBRID_MODE = True: manual override — puwersahang gamitin ang assumed weight
(2.0g / week 1) kahit may totoong weight data. Default False: totoong weight
kapag meron, assumed kapag wala. Auto-detected pa rin ang rfMode label.
"""

import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd
import numpy as np
import joblib
import json
import math
import os
from datetime import datetime, timedelta, timezone

# ============================================================
# CONFIG
# ============================================================
SERVICE_KEY = "serviceAccountKey.json"
MODEL_FILE = "rf_growth_model.joblib"

HYBRID_MODE = False         # manual override: True = force assumed weight
                            # (2.0g / week 1) kahit may totoong weight data
ASSUMED_START_WEIGHT = 2.0  # juvenile start (g) — fallback kapag walang sample
HARVEST_WEEK = 18
GATE_DAYS = 90  # panelist requirement: yield prediction only after 3 months of real cultivation data

# Fetch settings — per-day direct reads (see fetch_day_readings), cache-aware
DAILY_CACHE_FILE = "daily_averages_cache.json"  # per-day aggregate cache (gitignored)
ESTIMATED_READS_PER_DAY = 720  # rough estimate for the guardrail PRE-check only —
                                # correct against actual live daily doc counts;
                                # post-fetch counter update always uses the real count.
GRACE_DAYS = 2  # old empty days (older than today - GRACE_DAYS) are marked
                # "confirmed empty" and stop being retried; the last GRACE_DAYS
                # days are excluded from the completeness requirement entirely
                # (assumed possible delayed upload, not a permanent gap).

# Read guardrail (Firestore free tier protection)
DAILY_READ_LIMIT = 50000    # Firestore free tier (Spark plan)
SAFETY_THRESHOLD = 40000    # mag-warning bago maabot ang limit
READ_COUNTER_FILE = "read_counter.json"

# RF features (8 — dapat tugma sa training; walang salinity/waterLevel)
FEATURES = [
    "weekNumber", "currentWeight",
    "avgWaterTemp", "avgPh", "avgDissolvedOxygen",
    "avgTds", "avgTurbidity", "avgFeedRate",
]

# water stat field -> reading doc's statistics.<key>.average (single source
# of truth, shared by fetch_day_readings)
STAT_MAP = {
    "avgWaterTemp": "waterTemperatureC",
    "avgPh": "phValue",
    "avgDissolvedOxygen": "oxygenLevelMgL",
    "avgTds": "tdsPpm",
    "avgTurbidity": "turbidityNTU",
}

# ============================================================
# READ GUARDRAIL
# ============================================================
def load_read_counter():
    """Basahin ang reads ngayong araw. Auto-reset kada bagong araw."""
    today = datetime.now().strftime("%Y-%m-%d")
    if os.path.exists(READ_COUNTER_FILE):
        try:
            with open(READ_COUNTER_FILE, "r") as f:
                data = json.load(f)
            if data.get("date") == today:
                return data.get("reads", 0)
        except (json.JSONDecodeError, IOError):
            pass
    return 0  # bagong araw o walang file

def save_read_counter(reads):
    """I-save ang total reads ngayong araw."""
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(READ_COUNTER_FILE, "w") as f:
            json.dump({"date": today, "reads": reads}, f)
    except IOError as e:
        print(f"[WARN] Hindi na-save ang read counter: {e}")

def check_read_guardrail(planned_reads):
    """
    Tignan kung ligtas mag-run bago pa kumuha ng data.
    Nagbabalik ng True kung tuloy, False kung hinto.
    """
    current = load_read_counter()
    projected = current + planned_reads

    print("\n" + "-" * 55)
    print("[GUARDRAIL] Firestore read check")
    print(f"[GUARDRAIL] Reads na ngayong araw : {current:,}")
    print(f"[GUARDRAIL] Planong reads ngayon  : ~{planned_reads:,}")
    print(f"[GUARDRAIL] Projected total        : {projected:,} / {DAILY_READ_LIMIT:,}")
    print("-" * 55)

    if projected > DAILY_READ_LIMIT:
        print(f"\n[!!!] BABALA: LALAMPAS sa FREE TIER ({DAILY_READ_LIMIT:,} reads/araw)!")
        print(f"[!!!] Kung tutuloy: {projected:,} reads — MAAARING SININGIL ka.")
        resp = input("[?] Tuloy pa rin? (i-type 'oo' para tumuloy): ").strip().lower()
        if resp != "oo":
            print("[GUARDRAIL] HININTO — para hindi lumampas sa free tier.")
            return False
        return True

    if projected > SAFETY_THRESHOLD:
        remaining = DAILY_READ_LIMIT - projected
        print(f"\n[!] PAALALA: Malapit na sa limit (>{SAFETY_THRESHOLD:,}).")
        print(f"[!] Matitira: ~{remaining:,} reads pagkatapos nito.")
        resp = input("[?] Tuloy? (Enter = tuloy, 'x' = hinto): ").strip().lower()
        if resp == "x":
            print("[GUARDRAIL] HININTO ng user.")
            return False
        return True

    remaining = DAILY_READ_LIMIT - projected
    print(f"[GUARDRAIL] LIGTAS — ~{remaining:,} reads matitira pagkatapos nito.\n")
    return True

# ============================================================
# 1. CONNECT SA FIRESTORE
# ============================================================
def connect_firestore():
    cred = credentials.Certificate(SERVICE_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("[OK] Connected sa Firestore")
    return db

# ============================================================
# 2. DAILY AGGREGATE CACHE (incremental, per-day direct reads)
# ============================================================
def load_daily_cache():
    """Basahin ang per-day aggregate cache. {"cycleStart": None, "days": {}}
    kung wala pa o corrupt ang file (parehong graceful-degrade style ng
    load_read_counter())."""
    if os.path.exists(DAILY_CACHE_FILE):
        try:
            with open(DAILY_CACHE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"cycleStart": None, "days": {}}

def save_daily_cache(cache):
    """I-save ang buong daily cache dict pabalik sa DAILY_CACHE_FILE."""
    try:
        with open(DAILY_CACHE_FILE, "w") as f:
            json.dump(cache, f)
    except IOError as e:
        print(f"[WARN] Hindi na-save ang daily cache: {e}")

def reconcile_daily_cache(cache, cycle_start):
    """I-clear ang buong cache kung iba na ang cycleStart (bagong grow
    cycle) — invalid na ang mga naka-cache na araw. Mirrors
    readingsService.js's reconcileCycleStart()."""
    cycle_start_iso = cycle_start.isoformat()
    if cache.get("cycleStart") != cycle_start_iso:
        return {"cycleStart": cycle_start_iso, "days": {}}
    return cache

def get_missing_dates(cache, start_date, today):
    """Mga petsa mula start_date hanggang KAHAPON (hindi kasama si today,
    laging fresh-fetch iyon) na wala pang entry sa cache["days"]."""
    missing = []
    d = start_date
    while d < today:
        if d.isoformat() not in cache["days"]:
            missing.append(d)
        d += timedelta(days=1)
    return missing

def fetch_day_readings(db, year, month, day):
    """
    Direktang path read para sa ISANG araw (hindi collection_group scan):
    HistoryLogs/Ulang/years/reading_YYYY/reading_MM/reading_DD/readings
    (zero-padded ang month/day segments — verified sa Firestore console).

    Nagbabalik: (day_avgs dict {feat: float|None}, usable_n, docs_streamed)
    """
    coll = (
        db.collection("HistoryLogs").document("Ulang")
          .collection("years").document(f"reading_{year}")
          .collection(f"reading_{month:02d}").document(f"reading_{day:02d}")
          .collection("readings")
    )
    docs = list(coll.stream())

    collected = {k: [] for k in STAT_MAP}
    usable_n = 0
    for doc in docs:
        data = doc.to_dict()
        stats = data.get("statistics", {})
        if not stats:
            continue
        got = False
        for feat, stat_key in STAT_MAP.items():
            param = stats.get(stat_key, {})
            avg = param.get("average")
            if avg is not None:
                collected[feat].append(float(avg))
                got = True
        if got:
            usable_n += 1

    day_avgs = {feat: (float(np.mean(vals)) if vals else None) for feat, vals in collected.items()}
    return day_avgs, usable_n, len(docs)

def backfill_missing_days(db, daily_cache, missing_dates, budget_remaining, grace_cutoff):
    """
    Auto-capped, non-interactive backfill loop: fetches missing days
    (oldest first) directly via fetch_day_readings, stopping BEFORE any day
    likely to exceed budget_remaining (pre-check) and immediately after any
    day that did anyway (post-check safety net). Saves the cache after
    EVERY day — if the process is killed mid-loop, only the in-flight day
    is lost, every prior day this run is already durable.

    A day with n == 0 usable readings is cached as an empty marker
    ({"n": 0}) once it's older than grace_cutoff — a real cache key, so
    get_missing_dates() naturally treats it as done and never re-fetches
    it. A day within the grace window (>= grace_cutoff) is left uncached
    on n == 0, in case it's a delayed upload — retried next run.

    No input() prompt — fully automatic. A run that stops here because of
    the budget leaves the cache exactly where it left off; the next run
    resumes via get_missing_dates() (cached days = 0 reads).

    Nagbabalik: (reads_used, days_fetched)
    """
    reads_used = 0
    days_fetched = 0

    for d in missing_dates:
        if reads_used + ESTIMATED_READS_PER_DAY > budget_remaining:
            break  # pre-check: don't start a day likely to overshoot

        day_avgs, n, docs_streamed = fetch_day_readings(db, d.year, d.month, d.day)
        reads_used += docs_streamed
        if n > 0:
            entry = dict(day_avgs)
            entry["n"] = n
            daily_cache["days"][d.isoformat()] = entry
        elif d < grace_cutoff:
            # genuinely empty, past the grace window — mark done, never retry
            daily_cache["days"][d.isoformat()] = {"n": 0}
        # else: n == 0 but still within the grace window — leave uncached,
        # retry next run (possible delayed upload).
        save_daily_cache(daily_cache)
        days_fetched += 1
        status = "cached" if (n > 0 or d < grace_cutoff) else "grace-retry"
        print(f"[BACKFILL] {d.isoformat()}: {n} usable readings ({docs_streamed} read, {status})")

        if reads_used >= budget_remaining:
            break  # post-check: a day ran hotter than the estimate

    return reads_used, days_fetched

def fetch_today_and_average(db, daily_cache, today):
    """
    Call ONLY once backfill is complete (zero missing days). Fetches TODAY
    fresh — never cached as final, patuloy pang dumadagdag ang readings
    ngayong araw — then computes the READING-COUNT-WEIGHTED whole-cycle
    average across all cached days + today.

    Nagbabalik: (water_dict, total_readings_used, actual_reads)
    """
    today_avgs, today_n, actual_reads = fetch_day_readings(db, today.year, today.month, today.day)
    print(f"[INFO] {today.isoformat()} (today, hindi kino-cache): {today_n} usable readings ({actual_reads} read)")

    all_days = list(daily_cache["days"].values())
    if today_n > 0:
        all_days.append(dict(today_avgs, n=today_n))

    water = {}
    for feat in STAT_MAP:
        weighted_sum = 0.0
        weight_total = 0
        for day in all_days:
            val = day.get(feat)
            n = day.get("n", 0)
            if val is not None and n > 0:
                weighted_sum += val * n
                weight_total += n
        water[feat] = (weighted_sum / weight_total) if weight_total > 0 else None

    total_n = sum(day.get("n", 0) for day in all_days)
    if total_n == 0:
        print("[WARN] Walang usable readings sa buong cycle range — test-mode fallback")
        return None, 0, actual_reads

    data_days = sum(1 for day in all_days if day.get("n", 0) > 0)
    empty_days = len(all_days) - data_days
    print(f"[OK] Na-aggregate: {total_n} readings sa {data_days} data days ({len(all_days)} sa range, {empty_days} empty) — weighted by n")
    return water, total_n, actual_reads

# ============================================================
# 3. ASSUMED VALUES (HYBRID MODE)
# ============================================================
def optimal_feed_rate(weight):
    """Gupta et al.: 10% (maliit) -> 5% (malaki). Linear interpolation."""
    if weight <= 2:
        return 10.0
    if weight >= 25:
        return 5.0
    return 10.0 - (weight - 2) * (5.0 / 23.0)

def get_optimal_fallback():
    """Assumed optimal conditions kung walang totoong water data."""
    return {
        "avgWaterTemp": 29.0, "avgPh": 7.6, "avgDissolvedOxygen": 6.5,
        "avgTds": 250.0, "avgTurbidity": 12.0,
    }

# ============================================================
# 4. PROJECT HARVEST WEIGHT (via RF)
# ============================================================
def project_harvest_weight(model, water, start_weight, start_week=1):
    """I-project ang weight mula (start_week, start_weight) hanggang harvest
    (week 18). start_weight = timbang na PAPASOK sa start_week; may growth step
    kada linggo mula start_week..18. Feed assumed pa rin (optimal_feed_rate
    curve). start_week > HARVEST_WEEK -> empty loop, ibabalik ang start_weight
    (nasa/lampas na sa harvest)."""
    weight = start_weight
    for wk in range(start_week, HARVEST_WEEK + 1):
        feed_rate = optimal_feed_rate(weight)  # assumed (hybrid)
        feat = pd.DataFrame([{
            "weekNumber": wk,
            "currentWeight": weight,
            "avgWaterTemp": water["avgWaterTemp"],
            "avgPh": water["avgPh"],
            "avgDissolvedOxygen": water["avgDissolvedOxygen"],
            "avgTds": water["avgTds"],
            "avgTurbidity": water["avgTurbidity"],
            "avgFeedRate": feed_rate,
        }])[FEATURES]
        growth = float(model.predict(feat)[0])
        weight += growth
    return weight

# ============================================================
# 4b. FETCH TOTAL DEATHS SINCE CYCLE START (data-based survival)
# ============================================================
def fetch_total_deaths(db, cycle_start):
    """Kabuuang deathCount mula mortality_records mula cycle_start.
    Mirrors dashboard.js loadMortalityStat / survivalChart.js loadDeathsByWeek."""
    docs = list(db.collection("mortality_records").where("createdAt", ">=", cycle_start).stream())
    total_deaths = sum((d.to_dict().get("deathCount") or 0) for d in docs)
    return total_deaths, len(docs)

# ============================================================
# 4c. FETCH LATEST REAL WEIGHT (ulang_growth_records, real currentWeight)
# ============================================================
def fetch_latest_real_weight(db, cycle_start):
    """Latest week's average weight (g) mula ulang_growth_records.
    Sinasalamin ang avgWeightChart.js loadWeightsByWeek: week = floor(days_
    since_cycleStart / 7) + 1, per-week AVERAGE (hindi raw sum), kunin ang
    PINAKA-BAGONG week na may sample -> yun ang totoong currentWeight at week
    index nito. Ganito rin ang bucketing sa web para magkasundo.

    Nagbabalik: (avg_weight_g, latest_week, records_read) o
    (None, None, records_read) kung walang usable sample."""
    docs = list(db.collection("ulang_growth_records").where("createdAt", ">=", cycle_start).stream())
    MS_PER_WEEK = 7 * 24 * 60 * 60  # seconds (mirror ng JS MS_PER_WEEK)

    by_week = {}  # {week: [weights]}
    for d in docs:
        data = d.to_dict()
        created = data.get("createdAt")
        weight = data.get("weight")
        if created is None or weight is None:
            continue  # malformed doc — skip (mirror ng JS Number.isFinite guard)
        week = int((created - cycle_start).total_seconds() // MS_PER_WEEK) + 1
        if week < 1:
            continue
        by_week.setdefault(week, []).append(float(weight))

    if not by_week:
        return None, None, len(docs)

    latest_week = max(by_week)  # LATEST week na may sample
    vals = by_week[latest_week]
    avg_weight = sum(vals) / len(vals)  # per-week average, hindi raw sum
    return avg_weight, latest_week, len(docs)

# ============================================================
# 0. GROWTH_INDICATORS DOC + 3-MONTH GATE
# ============================================================
def fetch_growth_indicators(db):
    """Kunin ang latest growth_indicators doc. None kung wala."""
    docs = list(db.collection("growth_indicators").limit(1).stream())
    if not docs:
        return None
    return docs[0]

# ============================================================
# 5. COMPUTE YIELD
# ============================================================
def compute_yield(gi_doc, gi, harvest_weight, total_deaths):
    """Yield = stock x survival x harvest_weight / 1000. Survival computed from
    logged mortality_records, not a typed Settings field (mirrors dashboard.js)."""
    stock = gi.get("initialStock", 50)
    survival = max(0.0, ((stock - total_deaths) / stock) * 100.0) if stock > 0 else 0.0
    yield_kg = stock * (survival / 100.0) * harvest_weight / 1000.0
    return gi_doc.reference, stock, survival, yield_kg

# ============================================================
# 6. ISULAT PABALIK SA FIRESTORE
# ============================================================
def write_prediction(doc_ref, harvest_weight, yield_kg, mode, n_readings, survival_note):
    notes = {
        "test": "Test-mode: assumed optimal conditions (walang readings pa)",
        "hybrid": "Hybrid: real water params, assumed biomass/feed",
        "real": "Real water + real biomass weight; feed via optimal-rate curve",
    }
    payload = {
        "rfProjectedWeight": round(harvest_weight, 2),
        "rfProjectedYield": round(yield_kg, 3),
        "rfMode": mode,
        "rfReadingsUsed": n_readings,
        "rfUpdatedAt": firestore.SERVER_TIMESTAMP,
        "rfNote": notes.get(mode, "Unknown mode") + " " + survival_note,
        "rfPending": False,
        "rfDaysUntilAvailable": None,
    }
    doc_ref.update(payload)
    print(f"[OK] Nasulat sa growth_indicators: {payload}")

# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 55)
    print("BANTAY ULANG — RF YIELD PREDICTION (Batch Inference)")
    print("=" * 55)

    db = connect_firestore()

    # --- 3-MONTH GATE (panelist requirement) — checked BEFORE the read
    # guardrail and the (expensive, up to 5000-read) water-data fetch, so a
    # too-young cycle costs one cheap read instead of thousands. ---
    gi_doc = fetch_growth_indicators(db)
    if gi_doc is None:
        print("[ERROR] Walang growth_indicators doc — hindi makakasulat")
        return

    gi = gi_doc.to_dict()
    cycle_start = gi.get("cycleStart")
    days_since_start = (datetime.now(timezone.utc) - cycle_start).days if cycle_start is not None else None
    eligible = days_since_start is not None and days_since_start >= GATE_DAYS

    if not eligible:
        days_remaining = (GATE_DAYS - days_since_start) if days_since_start is not None else None
        weeks_remaining = math.ceil(days_remaining / 7) if days_remaining is not None else None
        reason = "walang cycleStart" if days_since_start is None else f"{days_since_start} araw pa lang (kailangan {GATE_DAYS})"
        print(f"[GATE] Hindi pa eligible: {reason}")
        gi_doc.reference.update({
            "rfPending": True,
            "rfDaysUntilAvailable": days_remaining,
        })
        print(f"[GATE] Na-mark bilang rfPending"
              + (f" — ~{weeks_remaining} linggo pa" if weeks_remaining is not None else "") + ".")
        print("[EXIT] Wala pang isusulat na prediction.")
        return

    print(f"[GATE] Eligible — {days_since_start} araw na mula sa cycle start.")

    # --- DATA-BASED SURVIVAL (mortality_records, mirrors dashboard.js/survivalChart.js) ---
    # Fetched before the read guardrail — it's a small, technician-logged
    # collection, not sensor-volume like the water-averages fetch below.
    try:
        total_deaths, mortality_reads = fetch_total_deaths(db, cycle_start)
    except Exception as e:
        print(f"[ERROR] Hindi nakuha ang mortality_records: {e}")
        print("[EXIT] Hindi tumuloy — survival data unavailable.")
        return

    if total_deaths == 0:
        survival_note = "No mortality logged this cycle — survival assumed 100%."
    else:
        survival_note = "Survival based on current logged mortality (as-of-date), not final harvest survival."
    print(f"[OK] Mortality: {total_deaths} logged deaths mula cycle start ({mortality_reads} records read)")

    # --- DAILY CACHE — load + reconcile + missing-days list. Local file I/O
    # only, no Firestore reads, so safe to do before any budget/guardrail
    # check. ---
    daily_cache = load_daily_cache()
    daily_cache = reconcile_daily_cache(daily_cache, cycle_start)
    today = datetime.now(timezone.utc).date()
    missing_dates = get_missing_dates(daily_cache, cycle_start.date(), today)
    grace_cutoff = today - timedelta(days=GRACE_DAYS)

    # --- AUTO-CAPPED BACKFILL (no prompt) — spreads a large initial
    # backfill across multiple runs/days instead of one big fetch. Budget =
    # what's left of today's SAFETY_THRESHOLD after reads already spent
    # today. ---
    current_reads_today = load_read_counter()
    budget_remaining = max(0, SAFETY_THRESHOLD - current_reads_today)
    reads_used, days_fetched = backfill_missing_days(db, daily_cache, missing_dates, budget_remaining, grace_cutoff)
    if days_fetched:
        print(f"[BACKFILL] {days_fetched}/{len(missing_dates)} day(s) fetched this run ({reads_used} reads).")

    # Persist the counter NOW — includes the gate check (+1) and
    # mortality_reads from earlier in this run, not just reads_used, so an
    # incomplete-backfill exit below still records every read this run
    # actually spent. Must happen BEFORE the completeness gate can return,
    # or a same-day re-run wouldn't know this budget was already used.
    save_read_counter(current_reads_today + reads_used + mortality_reads + 1)

    # --- COMPLETENESS GATE — do NOT fetch today or predict until every day
    # from cycleStart to (today - GRACE_DAYS) is cached (real data or an
    # empty marker). The last GRACE_DAYS days are excluded from this check
    # on purpose — they're allowed to still be pending delayed uploads
    # without blocking prediction indefinitely. Partial state is fine; the
    # prediction just waits on the OLD days, not the recent grace window. ---
    remaining_missing = get_missing_dates(daily_cache, cycle_start.date(), grace_cutoff)
    if remaining_missing:
        total_days_in_range = (grace_cutoff - cycle_start.date()).days
        cached_days = total_days_in_range - len(remaining_missing)
        gi_doc.reference.update({
            "rfPending": True,
            "rfBackfillDaysRemaining": len(remaining_missing),
            "rfNote": f"Building sensor history: {cached_days}/{total_days_in_range} days cached "
                      f"— backfill incomplete, re-run to continue (quota resets daily).",
        })
        print(f"[BACKFILL] Incomplete — {len(remaining_missing)} day(s) remaining. Exiting; re-run to continue.")
        return

    # --- READ GUARDRAIL (bago kumuha ng today's data) — backfill is
    # self-limiting and already done above, so this only guards the small,
    # steady-state "fetch today" step. ---
    planned_today = ESTIMATED_READS_PER_DAY + 1
    if not check_read_guardrail(planned_today):
        print("[EXIT] Hindi tumuloy — read guardrail.")
        return

    model = joblib.load(MODEL_FILE)
    print(f"[OK] Na-load ang model: {MODEL_FILE}")

    # Kunin ang water data — backfill complete, fetch today + weighted average
    water, n_readings, actual_reads = fetch_today_and_average(db, daily_cache, today)

    # Totoong biomass weight mula ulang_growth_records (maliit na manual-log
    # collection, tulad ng mortality_records). Fetched DITO — pagkatapos ng
    # backfill/guardrail gates — para hindi masayang ang reads sa maagang exit.
    real_weight, real_week, ulang_reads = fetch_latest_real_weight(db, cycle_start)

    # I-update ang read counter (dagdag na lang dito — backfill + mortality +
    # gate check ay na-save na sa itaas). Kasama ang today + ulang_growth reads.
    current = load_read_counter()
    save_read_counter(current + actual_reads + ulang_reads)
    print(f"[GUARDRAIL] Na-update ang counter: {current + actual_reads + ulang_reads:,} reads ngayong araw")

    # Determine mode + currentWeight source — auto-detected mula sa TOTOONG
    # data na ginamit (hindi na label lang). HYBRID_MODE=True = manual override
    # para puwersahang gamitin ang assumed weight kahit may totoong sample.
    if water is None or any(v is None for v in water.values()):
        print("[MODE] Walang kumpletong water data -> TEST-MODE (assumed optimal)")
        water = get_optimal_fallback()
        mode = "test"
        n_readings = 0
        start_weight, start_week = ASSUMED_START_WEIGHT, 1
    else:
        use_real_weight = (real_weight is not None) and not HYBRID_MODE
        if use_real_weight:
            start_weight, start_week = real_weight, real_week + 1  # project weeks AFTER measured
            mode = "real"
        else:
            start_weight, start_week = ASSUMED_START_WEIGHT, 1
            mode = "hybrid"
        print(f"[MODE] {mode.upper()} — totoong water params, "
              + ("totoong weight" if use_real_weight else "assumed weight"))
        print(f"       Water: temp={water['avgWaterTemp']:.1f} pH={water['avgPh']:.2f} "
              f"DO={water['avgDissolvedOxygen']:.1f} tds={water['avgTds']:.0f} "
              f"turb={water['avgTurbidity']:.1f}")
        if real_weight is not None and HYBRID_MODE:
            print(f"[WEIGHT] Override: may totoong weight ({real_weight:.1f}g sa week "
                  f"{real_week}) pero HYBRID_MODE=True -> assumed pa rin.")

    # Project harvest weight mula sa (start_week, start_weight)
    harvest_weight = project_harvest_weight(model, water, start_weight, start_week)
    print(f"[OK] Projected harvest weight: {harvest_weight:.1f}g "
          f"(mula {start_weight:.1f}g sa week {start_week}, hanggang week {HARVEST_WEEK})")

    # Compute yield
    doc_ref, stock, survival, yield_kg = compute_yield(gi_doc, gi, harvest_weight, total_deaths)
    print(f"[OK] YIELD = {stock} x {survival:.1f}% x {harvest_weight:.1f}g / 1000 = {yield_kg:.2f} kg")

    # Isulat pabalik
    write_prediction(doc_ref, harvest_weight, yield_kg, mode, n_readings, survival_note)

    print("=" * 55)
    print("TAPOS — prediction nasa Firestore growth_indicators")
    print("=" * 55)

if __name__ == "__main__":
    main()
