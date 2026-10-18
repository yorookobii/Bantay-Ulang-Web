"""
Bantay Ulang — RF Yield Prediction (Batch Inference)
=====================================================
Kumukuha ng water parameters mula Firestore (collection group query sa
"readings" — HistoryLogs/Ulang/years/reading_YYYY/reading_MM/reading_DD/readings),
ini-average, pinapakain sa trained Random Forest, nag-pro-project ng harvest
weight, at isinusulat ang yield prediction pabalik sa growth_indicators.

DATA MODE (auto-detected sa rfMode):
  - Water parameters: TOTOO mula Firestore (temp, pH, tds, turbidity), may
    per-reading sanity filter; walang DO (hindi ito feature ng v2 model)
  - currentWeight: median ng pinakabagong usable week sa ulang_growth_records
    (hindi flagged, >= MIN_WEEK_SAMPLES); kung wala pa, growth_indicators.stockingWeight
  - feedRate: ASSUMED pa rin (optimal_feed_rate curve) — hiwalay na phase
  - survival: week-21 trend ng logged mortality (project_survival, mirror ng web survivalTrend.js)

EARLY PROJECTION: bago ang GATE_DAYS, kapag >= EARLY_MIN_USABLE_WEEKS usable weight weeks,
rfProjection* fields lang ang isinusulat (walang yield number, rfPending pa rin).

READ GUARDRAIL:
  - Nagta-track ng Firestore reads kada araw (local JSON file)
  - Nag-wa-warning bago maabot ang free tier limit (50,000 reads/araw)

HYBRID_MODE = True: manual override — puwersahang gamitin ang stocking weight
(week 1) kahit may totoong weight data. Default False: totoong weight
kapag meron, stocking weight kapag wala. Auto-detected pa rin ang rfMode label.
"""

import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd
import numpy as np
import joblib
import json
import math
import os
import sklearn
from datetime import date, datetime, timedelta, timezone

# ============================================================
# CONFIG
# ============================================================
SERVICE_KEY = "serviceAccountKey.json"
MODEL_FILE = "rf_growth_model_v2.joblib"  # v1 (rf_growth_model.joblib) is kept but no longer used
MODEL_META_FILE = "model_meta.json"        # written by train_model.py: features, featureRanges, versions

HYBRID_MODE = False         # manual override: True = force stocking weight
                            # (week 1) kahit may totoong weight data
HARVEST_WEEK = 150 // 7     # 150-day grow-out, the same horizon as generate_synthetic.py
GATE_DAYS = 90  # panelist requirement: yield prediction only after 3 months of real cultivation data
EARLY_MIN_USABLE_WEEKS = 2  # early projection (before GATE_DAYS) needs this many usable weight weeks
SURVIVAL_TREND_MIN_WEEKS = 3  # survival trend needs this many completed weeks, same as web survivalTrend.js

# Fetch settings — per-day direct reads (see fetch_day_readings), cache-aware
DAILY_CACHE_FILE = "daily_averages_cache.json"  # per-day aggregate cache (gitignored)
ESTIMATED_READS_PER_DAY = 720  # rough estimate for the guardrail PRE-check only —
                                # correct against actual live daily doc counts;
                                # post-fetch counter update always uses the real count.
INCLUDE_SYNTHETIC = False  # isSynthetic: true docs (hal. ESP32_SYNTHETIC_BACKFILL) never feed the model unless True
CACHE_VERSION = 3  # v3: sanity filter + per-parameter counts, walang DO; ibang version = clear ang buong daily cache
# HistoryLogs day folders are named by the ESP32's local (PHT) date: reading_365 on Oct 6
# has time "18:12:25" while measuredAt is 10:12:25 UTC, so every day walk uses PHT dates.
PHT = timezone(timedelta(hours=8))
GRACE_DAYS = 2  # old empty days (older than today - GRACE_DAYS) are marked
                # "confirmed empty" and stop being retried; the last GRACE_DAYS
                # days are excluded from the completeness requirement entirely
                # (assumed possible delayed upload, not a permanent gap).

# Read guardrail (Firestore free tier protection)
DAILY_READ_LIMIT = 50000    # Firestore free tier (Spark plan)
SAFETY_THRESHOLD = 40000    # mag-warning bago maabot ang limit
READ_COUNTER_FILE = "read_counter.json"

# water stat field -> firmware key, read as statistics.<key>.average (old docs)
# or flat top-level <key> (docs from Oct 13 2026 evening) via stat_value()
# (single source of truth, shared by fetch_day_readings); no DO, the v2 model doesn't use it.
# Model features come from model_meta.json, not a constant here.
STAT_MAP = {
    "avgWaterTemp": "waterTemperatureC",
    "avgPh": "phValue",
    "avgTds": "tdsPpm",
    "avgTurbidity": "turbidityNTU",
}

# Per-reading water sanity filter, applied before daily averages.
TURBIDITY_MAX_NTU = 90  # >= this means the probe is out of water (maintenance)
PH_MIN, PH_MAX = 4.0, 11.0
PH_TRUSTED_FROM = None  # PHT date of pH probe calibration, e.g. date(2026, 10, 20); earlier pH is dropped

# Weight plausibility flags, a mirror of web reportCleanup.js flagWeights; change both together.
WEIGHT_CAP_BASE_G = 5
WEIGHT_CAP_PER_WEEK_G = 5
WEIGHT_MEDIAN_FACTOR = 3
STOCK_LOW_FACTOR = 0.5
STOCK_HIGH_FACTOR = 4
STOCK_HIGH_PER_WEEK_G = 10
MIN_WEEK_SAMPLES = 10      # a week's weight is used only with at least this many samples

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
    if cache.get("cycleStart") != cycle_start_iso or cache.get("version") != CACHE_VERSION:
        return {"version": CACHE_VERSION, "cycleStart": cycle_start_iso, "days": {}}
    return cache

def ph_date(ts):
    """Petsa sa PHT ng isang aware datetime — ito ang pangalan ng day folder."""
    return ts.astimezone(PHT).date()

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

def stat_value(data, key):
    """statistics.<key>.average (lumang docs) o flat top-level <key> (bagong docs)."""
    avg = ((data.get("statistics") or {}).get(key) or {}).get("average")
    if avg is not None:
        return avg
    v = data.get(key)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

def drop_reason(feat, value, day):
    """Dahilan kung bakit itatapon ang isang reading value (None kung ok); day = PHT date ng reading."""
    if feat == "avgTurbidity" and value >= TURBIDITY_MAX_NTU:
        return "turbidity probe out of water"
    if feat == "avgPh":
        if PH_TRUSTED_FROM is not None and day < PH_TRUSTED_FROM:
            return "pH before probe calibration"
        if not PH_MIN <= value <= PH_MAX:
            return "pH out of range"
    return None

def fetch_day_readings(db, year, month, day):
    """
    Direktang path read para sa ISANG araw (hindi collection_group scan):
    HistoryLogs/Ulang/years/reading_YYYY/reading_MM/reading_DD/readings
    (zero-padded ang month/day segments — verified sa Firestore console).

    Docs na isSynthetic: true ay nilalaktawan maliban kung INCLUDE_SYNTHETIC.
    Parehong schema ang binabasa (nested statistics o flat fields, tingnan ang stat_value).

    Bawat value ay dumadaan sa drop_reason; ang natapon ay binibilang kada parameter.

    Nagbabalik: (day_avgs dict {feat: float|None}, usable_n, docs_streamed, synthetic_used,
                 qc {"counts": {feat: kept}, "dropped": {feat: dropped}})
    """
    coll = (
        db.collection("HistoryLogs").document("Ulang")
          .collection("years").document(f"reading_{year}")
          .collection(f"reading_{month:02d}").document(f"reading_{day:02d}")
          .collection("readings")
    )
    docs = list(coll.stream())

    reading_day = date(year, month, day)
    collected = {k: [] for k in STAT_MAP}
    dropped = {k: 0 for k in STAT_MAP}
    usable_n = 0
    synthetic_used = 0
    for doc in docs:
        data = doc.to_dict()
        is_synthetic = data.get("isSynthetic") is True
        if is_synthetic and not INCLUDE_SYNTHETIC:
            continue
        got = False
        for feat, stat_key in STAT_MAP.items():
            avg = stat_value(data, stat_key)
            if avg is None:
                continue
            if drop_reason(feat, float(avg), reading_day):
                dropped[feat] += 1
                continue
            collected[feat].append(float(avg))
            got = True
        if got:
            usable_n += 1
            synthetic_used += is_synthetic

    counts = {feat: len(vals) for feat, vals in collected.items()}
    if any(dropped.values()):
        print(f"[QC] {reading_day.isoformat()}: " + ", ".join(
            f"{feat} dropped {k}/{k + counts[feat]}" for feat, k in dropped.items() if k))
    day_avgs = {feat: (float(np.mean(vals)) if vals else None) for feat, vals in collected.items()}
    return day_avgs, usable_n, len(docs), synthetic_used, {"counts": counts, "dropped": dropped}

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

        day_avgs, n, docs_streamed, n_synthetic, qc = fetch_day_readings(db, d.year, d.month, d.day)
        reads_used += docs_streamed
        if n > 0:
            entry = dict(day_avgs, **qc)
            entry["n"] = n
            entry["n_synthetic"] = n_synthetic
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

    Nagbabalik: (water_dict, total_readings_used, actual_reads, provenance)
    provenance = {"source": live|synthetic|mixed, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"} o None
    """
    today_avgs, today_n, actual_reads, today_synthetic, today_qc = fetch_day_readings(db, today.year, today.month, today.day)
    print(f"[INFO] {today.isoformat()} (today, hindi kino-cache): {today_n} usable readings ({actual_reads} read)")

    dated_days = dict(daily_cache["days"])
    if today_n > 0:
        dated_days[today.isoformat()] = dict(today_avgs, **today_qc, n=today_n, n_synthetic=today_synthetic)
    all_days = list(dated_days.values())

    # Weighted by readings kept per parameter, since the sanity filter drops parameters independently.
    water = {}
    for feat in STAT_MAP:
        weighted_sum = 0.0
        weight_total = 0
        for day in all_days:
            val = day.get(feat)
            n = day.get("counts", {}).get(feat, 0)
            if val is not None and n > 0:
                weighted_sum += val * n
                weight_total += n
        water[feat] = (weighted_sum / weight_total) if weight_total > 0 else None

    total_n = sum(day.get("n", 0) for day in all_days)
    if total_n == 0:
        print("[WARN] Walang usable readings sa buong cycle range — test-mode fallback")
        return None, 0, actual_reads, None

    data_days = sum(1 for day in all_days if day.get("n", 0) > 0)
    empty_days = len(all_days) - data_days
    print(f"[OK] Na-aggregate: {total_n} readings sa {data_days} data days ({len(all_days)} sa range, {empty_days} empty) — weighted by n")

    # Saan galing ang water data: para sa honest na label sa web (rfWaterSource).
    synthetic_n = sum(day.get("n_synthetic", 0) for day in all_days)
    source = "live" if synthetic_n == 0 else "synthetic" if synthetic_n == total_n else "mixed"
    data_dates = sorted(date for date, day in dated_days.items() if day.get("n", 0) > 0)
    provenance = {"source": source, "from": data_dates[0], "to": data_dates[-1]}
    print(f"[OK] Water source: {source} ({synthetic_n} synthetic), {provenance['from']} hanggang {provenance['to']}")
    return water, total_n, actual_reads, provenance

# ============================================================
# 3. ASSUMED VALUES (HYBRID MODE)
# ============================================================
def optimal_feed_rate(weight):
    """SEAFDEC/AQD 2016 grow-out feed rate (% body weight/day): <5 g 10, 5-15 g 7, 15-25 g 5, >25 g 3; mirror of web feedRecommendation.js."""
    if weight < 5:
        return 10.0
    if weight < 15:
        return 7.0
    if weight <= 25:
        return 5.0
    return 3.0

def get_optimal_fallback():
    """Assumed optimal conditions kung walang totoong water data."""
    return {
        "avgWaterTemp": 29.0, "avgPh": 7.6,
        "avgTds": 250.0, "avgTurbidity": 12.0,
    }

# ============================================================
# 4. PROJECT HARVEST WEIGHT (via RF)
# ============================================================
def load_model():
    """(model, meta) mula MODEL_FILE + MODEL_META_FILE, o (None, None) kapag hindi tugma ang features o sklearn version."""
    model = joblib.load(MODEL_FILE)
    with open(MODEL_META_FILE, encoding="utf-8") as f:
        meta = json.load(f)
    if list(getattr(model, "feature_names_in_", [])) != meta["features"]:
        print(f"[ERROR] {MODEL_FILE} features {list(getattr(model, 'feature_names_in_', []))} != {MODEL_META_FILE} {meta['features']}")
        return None, None
    if meta["versions"]["sklearn"] != sklearn.__version__:
        print(f"[ERROR] Model trained on scikit-learn {meta['versions']['sklearn']}, installed {sklearn.__version__} — re-run train_model.py.")
        return None, None
    return model, meta

def out_of_range_notes(inputs, feature_ranges):
    """rfNote lines para sa model inputs na labas sa training featureRanges."""
    notes = []
    for feat, value in inputs.items():
        low, high = feature_ranges.get(feat, (-math.inf, math.inf))
        if not low <= value <= high:
            notes.append(f"{feat} {value:.1f} is outside the model's training range ({low:g} to {high:g}).")
    return notes

def project_weights(model, features, water, start_weight, start_week=1):
    """I-project ang weight mula (start_week, start_weight) hanggang harvest
    (HARVEST_WEEK). start_weight = timbang na PAPASOK sa start_week; may growth
    step kada linggo mula start_week..HARVEST_WEEK. Ang input columns ay galing
    sa model_meta.json features. Nagbabalik ng [(week, weight)] kada step;
    start_week > HARVEST_WEEK -> empty list (nasa/lampas na sa harvest)."""
    weight = start_weight
    trajectory = []
    for wk in range(start_week, HARVEST_WEEK + 1):
        row = {"weekNumber": wk, "currentWeight": weight, **water, "avgFeedRate": optimal_feed_rate(weight)}
        growth = float(model.predict(pd.DataFrame([row])[features])[0])
        weight += growth
        trajectory.append((wk, weight))
    return trajectory

def projection_fields(start_week, start_weight, source, trajectory, early, notes):
    """rfProjection* fields: anchor sa week start_week - 1 (0 = stocking day) + bawat projected week."""
    anchor_week = start_week - 1
    points = [(anchor_week, start_weight), *trajectory]
    return {
        "rfProjectionByWeek": [{"week": wk, "weightG": round(w, 2)} for wk, w in points],
        "rfProjectionStart": {"week": anchor_week, "weightG": round(start_weight, 2), "source": source},
        "rfProjectionUpdatedAt": firestore.SERVER_TIMESTAMP,
        "rfProjectionEarly": early,
        "rfProjectionNote": " ".join(notes) or None,
    }

# ============================================================
# 4b. FETCH TOTAL DEATHS SINCE CYCLE START (data-based survival)
# ============================================================
def mortality_week(data, cycle_start_day):
    """Cycle week mula createdAt vs CURRENT cycle start (PHT dates, parehong rule ng weights);
    stored weekNumber lang kapag walang createdAt. Mirror ng web survivalTrend.js mortalityWeek."""
    created = data.get("createdAt")
    if created is None:
        return data.get("weekNumber")
    return (ph_date(created) - cycle_start_day).days // 7 + 1

def fetch_total_deaths(db, cycle_start):
    """(total deaths, {week: deaths}, records read) mula mortality_records mula cycle_start.
    Total mirrors dashboard.js loadMortalityStat; by-week mirrors mortalityChart.js
    bucketDeathsByWeek: week mula createdAt vs current cycle_start (mortality_week),
    kaya na-re-bucket ang lumang records kapag inilipat ang cycle start; walang valid week = sa total lang."""
    docs = [d.to_dict() for d in db.collection("mortality_records").where("createdAt", ">=", cycle_start).stream()]
    cycle_start_day = ph_date(cycle_start)
    by_week = {}
    for d in docs:
        wk = mortality_week(d, cycle_start_day)
        if isinstance(wk, (int, float)) and not isinstance(wk, bool) and wk >= 1:
            by_week[int(wk)] = by_week.get(int(wk), 0) + (d.get("deathCount") or 0)
    total_deaths = sum((d.get("deathCount") or 0) for d in docs)
    return total_deaths, by_week, len(docs)

def project_survival(deaths_by_week, stock, current_week):
    """Survival % sa HARVEST_WEEK sa compounded average weekly death rate ng completed weeks
    (walang record = 0 deaths); None kung < SURVIVAL_TREND_MIN_WEEKS. Mirror ng web survivalTrend.js."""
    k = min(current_week - 1, HARVEST_WEEK)
    if k < SURVIVAL_TREND_MIN_WEEKS:
        return None
    deaths = sum(deaths_by_week.get(w, 0) for w in range(1, k + 1))
    survival_k = max(0.0, (stock - deaths) / stock * 100.0)
    rate = 1.0 - (survival_k / 100.0) ** (1.0 / k)
    return survival_k * (1.0 - rate) ** (HARVEST_WEEK - k)

# ============================================================
# 4c. FETCH LATEST REAL WEIGHT (ulang_growth_records, real currentWeight)
# ============================================================
def fetch_weights_by_week(db, cycle_start):
    """Raw weight samples mula ulang_growth_records, naka-group kada week.
    Week = PHT-day difference // 7 + 1, parehong rule ng daily cache at
    weekly_water; tugma sa web kapag PHT midnight ang cycleStart (galing Settings).

    Nagbabalik: ({week: [weights]}, records_read)"""
    docs = list(db.collection("ulang_growth_records").where("createdAt", ">=", cycle_start).stream())
    cycle_start_day = ph_date(cycle_start)

    by_week = {}  # {week: [weights]}
    for d in docs:
        data = d.to_dict()
        created = data.get("createdAt")
        weight = data.get("weight")
        if created is None or weight is None:
            continue  # malformed doc — skip (mirror ng JS Number.isFinite guard)
        week = (ph_date(created) - cycle_start_day).days // 7 + 1
        if week < 1:
            continue
        by_week.setdefault(week, []).append(float(weight))
    return by_week, len(docs)

def weekly_weight_stats(by_week):
    """{week: {"median", "mean", "n"}} mula sa raw samples; ang mean ay para lang sa flags na tugma sa web."""
    return {wk: {"median": float(np.median(v)), "mean": float(np.mean(v)), "n": len(v)} for wk, v in by_week.items()}

def flag_weights(stats, stocking_g=None):
    """{week: reason} para sa weekly mean na labas sa bounds; port ng reportCleanup.js flagWeights."""
    values = [s["mean"] for s in stats.values()]
    med = float(np.median(values)) if values else None
    stock = float(stocking_g) if isinstance(stocking_g, (int, float)) and stocking_g > 0 else None
    flags = {}
    for week, s in stats.items():
        v = s["mean"]
        reasons = []
        if stock is not None:
            low = round(STOCK_LOW_FACTOR * stock, 1)
            high = round(STOCK_HIGH_FACTOR * stock + STOCK_HIGH_PER_WEEK_G * week, 1)
            if v < low:
                reasons.append(f"Below the {low:g} g minimum ({STOCK_LOW_FACTOR:g}x the {stock:g} g stocking weight)")
            if v > high:
                reasons.append(f"Above the {high:g} g limit for week {week}")
        else:
            cap = WEIGHT_CAP_BASE_G + WEIGHT_CAP_PER_WEEK_G * week
            if v > cap:
                reasons.append(f"Above the {cap} g limit for week {week}")
        if med is not None and v > WEIGHT_MEDIAN_FACTOR * med:
            reasons.append(f"More than {WEIGHT_MEDIAN_FACTOR}x the median weekly average ({round(med, 1):g} g)")
        if reasons:
            flags[week] = "; ".join(reasons)
    return flags

def usable_weeks(stats, flags):
    """Weeks na hindi flagged at may >= MIN_WEEK_SAMPLES samples."""
    return {wk for wk, s in stats.items() if wk not in flags and s["n"] >= MIN_WEEK_SAMPLES}

def fetch_latest_real_weight(db, cycle_start, stocking_g):
    """Median weight (g) ng PINAKA-BAGONG usable week, umaatras lampas sa flagged
    o kulang-sample na weeks (tulad ng web pickCurrentWeight).

    Nagbabalik: (median_g, week, sample_count, usable_count, records_read) o
    (None, None, None, 0, records_read) kung walang usable week."""
    by_week, n_docs = fetch_weights_by_week(db, cycle_start)
    stats = weekly_weight_stats(by_week)
    flags = flag_weights(stats, stocking_g)
    usable = usable_weeks(stats, flags)
    for wk in sorted(stats, reverse=True):
        if wk in usable:
            break
        reason = flags.get(wk) or f"{stats[wk]['n']} samples lang (kailangan {MIN_WEEK_SAMPLES})"
        print(f"[WEIGHT] Week {wk} nilaktawan: {reason}")
    if not usable:
        return None, None, None, 0, n_docs
    wk = max(usable)
    return stats[wk]["median"], wk, stats[wk]["n"], len(usable), n_docs

# ============================================================
# 0. GROWTH_INDICATORS DOC + 3-MONTH GATE
# ============================================================
def fetch_growth_indicators(db):
    """Kunin ang latest growth_indicators doc (by timestamp, same as web). None kung wala."""
    docs = list(db.collection("growth_indicators")
                .order_by("timestamp", direction=firestore.Query.DESCENDING).limit(1).stream())
    if not docs:
        return None
    return docs[0]

# ============================================================
# 5. COMPUTE YIELD
# ============================================================
def compute_yield(gi_doc, gi, harvest_weight, total_deaths, projected_survival):
    """Yield = stock x survival sa harvest x harvest_weight / 1000. Survival = projected_survival
    (week-HARVEST_WEEK trend) kapag meron, kung wala ay current survival mula logged
    mortality_records (mirrors dashboard.js), hindi typed Settings field.
    main() already exits when initialStock is missing or <= 0, so there is no default."""
    stock = gi["initialStock"]
    if projected_survival is not None:
        survival = projected_survival
    else:
        survival = max(0.0, ((stock - total_deaths) / stock) * 100.0)
    yield_kg = stock * (survival / 100.0) * harvest_weight / 1000.0
    return gi_doc.reference, stock, survival, yield_kg

# ============================================================
# 6. ISULAT PABALIK SA FIRESTORE
# ============================================================
WATER_SOURCE_TEXT = {"live": "live sensor", "synthetic": "synthetic", "mixed": "live + synthetic"}

def write_prediction(doc_ref, harvest_weight, yield_kg, survival, mode, n_readings, survival_note, provenance, extra_notes, projection):
    water = WATER_SOURCE_TEXT.get(provenance["source"]) if provenance else None
    notes = {
        "test": "Test-mode: assumed optimal conditions (walang readings pa)",
        "hybrid": f"Hybrid: {water} water params, stocking-weight biomass, assumed feed",
        "real": f"Real biomass weight + {water} water params; feed via optimal-rate curve",
    }
    payload = {
        "rfProjectedWeight": round(harvest_weight, 2),
        "rfProjectedYield": round(yield_kg, 3),
        "rfProjectedSurvival": round(survival, 2),  # the survival % used in rfProjectedYield
        "rfMode": mode,
        "rfReadingsUsed": n_readings,
        "rfWaterSource": provenance["source"] if provenance else None,
        "rfWaterFrom": provenance["from"] if provenance else None,
        "rfWaterTo": provenance["to"] if provenance else None,
        "rfUpdatedAt": firestore.SERVER_TIMESTAMP,
        "rfNote": " ".join([notes.get(mode, "Unknown mode"), survival_note, *extra_notes]),
        "rfPending": False,
        "rfDaysUntilAvailable": None,
        **projection,
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
        if cycle_start is None:
            print("[EXIT] Wala pang isusulat na prediction.")
            return
        print(f"[EARLY] Early projection lang (walang yield number bago ang day {GATE_DAYS}).")
    else:
        print(f"[GATE] Eligible — {days_since_start} araw na mula sa cycle start.")
    early = not eligible

    # Stock and stocking weight are checked before any expensive read; no default of 50 or 2.0 g.
    if not isinstance(gi.get("initialStock"), (int, float)) or gi["initialStock"] <= 0:
        print("[SKIP] initialStock missing or <= 0 — no yield write.")
        return
    stocking_g = gi.get("stockingWeight")
    if not isinstance(stocking_g, (int, float)) or stocking_g <= 0:
        print("[SKIP] stockingWeight missing — no projection.")
        return

    # Model is loaded before any expensive read so a mismatched model costs nothing.
    model, model_meta = load_model()
    if model is None:
        return
    print(f"[OK] Na-load ang model: {MODEL_FILE} ({', '.join(model_meta['features'])})")

    # Totoong biomass weight mula ulang_growth_records (maliit na manual-log
    # collection), fetched before the water backfill so an early run with too
    # few usable weeks exits after 1 + N reads.
    real_weight, real_week, real_n, n_usable, ulang_reads = fetch_latest_real_weight(db, cycle_start, stocking_g)
    if early and n_usable < EARLY_MIN_USABLE_WEEKS:
        save_read_counter(load_read_counter() + ulang_reads + 1)
        print(f"[EARLY] {n_usable} usable weight week(s) lang (kailangan {EARLY_MIN_USABLE_WEEKS}) — walang projection.")
        return

    # --- DATA-BASED SURVIVAL (mortality_records, mirrors dashboard.js/survivalChart.js) ---
    # Fetched before the read guardrail — it's a small, technician-logged
    # collection, not sensor-volume like the water-averages fetch below.
    # Skipped on the early path, which writes no yield.
    total_deaths, deaths_by_week, mortality_reads = 0, {}, 0
    if not early:
        try:
            total_deaths, deaths_by_week, mortality_reads = fetch_total_deaths(db, cycle_start)
        except Exception as e:
            print(f"[ERROR] Hindi nakuha ang mortality_records: {e}")
            print("[EXIT] Hindi tumuloy — survival data unavailable.")
            return
        print(f"[OK] Mortality: {total_deaths} logged deaths mula cycle start ({mortality_reads} records read)")

    # --- DAILY CACHE — load + reconcile + missing-days list. Local file I/O
    # only, no Firestore reads, so safe to do before any budget/guardrail
    # check. ---
    daily_cache = load_daily_cache()
    daily_cache = reconcile_daily_cache(daily_cache, cycle_start)
    today = ph_date(datetime.now(timezone.utc))
    cycle_start_day = ph_date(cycle_start)
    missing_dates = get_missing_dates(daily_cache, cycle_start_day, today)
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

    # Persist the counter NOW — includes the gate check (+1), ulang_reads and
    # mortality_reads from earlier in this run, not just reads_used, so an
    # incomplete-backfill exit below still records every read this run
    # actually spent. Must happen BEFORE the completeness gate can return,
    # or a same-day re-run wouldn't know this budget was already used.
    save_read_counter(current_reads_today + reads_used + mortality_reads + ulang_reads + 1)

    # --- COMPLETENESS GATE — do NOT fetch today or predict until every day
    # from cycleStart to (today - GRACE_DAYS) is cached (real data or an
    # empty marker). The last GRACE_DAYS days are excluded from this check
    # on purpose — they're allowed to still be pending delayed uploads
    # without blocking prediction indefinitely. Partial state is fine; the
    # prediction just waits on the OLD days, not the recent grace window. ---
    remaining_missing = get_missing_dates(daily_cache, cycle_start_day, grace_cutoff)
    if remaining_missing:
        total_days_in_range = (grace_cutoff - cycle_start_day).days
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

    # Kunin ang water data — backfill complete, fetch today + weighted average
    water, n_readings, actual_reads, provenance = fetch_today_and_average(db, daily_cache, today)

    # I-update ang read counter (dagdag na lang dito — backfill, mortality,
    # ulang_growth at gate check ay na-save na sa itaas). Today reads lang.
    current = load_read_counter()
    save_read_counter(current + actual_reads)
    print(f"[GUARDRAIL] Na-update ang counter: {current + actual_reads:,} reads ngayong araw")

    # Determine mode + currentWeight source — auto-detected mula sa TOTOONG
    # data na ginamit (hindi na label lang). HYBRID_MODE=True = manual override
    # para puwersahang gamitin ang stocking weight kahit may totoong sample.
    if water is None or any(v is None for v in water.values()):
        if early:
            print("[EARLY] Walang kumpletong water data — walang early projection (hindi gagamit ng assumed water).")
            return
        print("[MODE] Walang kumpletong water data -> TEST-MODE (assumed optimal)")
        water = get_optimal_fallback()
        mode = "test"
        n_readings = 0
        provenance = None
        start_weight, start_week = stocking_g, 1
    else:
        use_real_weight = (real_weight is not None) and not HYBRID_MODE
        if use_real_weight:
            start_weight, start_week = real_weight, real_week + 1  # project weeks AFTER measured
            mode = "real"
        else:
            start_weight, start_week = stocking_g, 1
            mode = "hybrid"
        print(f"[MODE] {mode.upper()} — {provenance['source']} water params, "
              + (f"totoong weight (median ng {real_n} samples)" if use_real_weight else "stocking weight"))
        print(f"       Water: temp={water['avgWaterTemp']:.1f} pH={water['avgPh']:.2f} "
              f"tds={water['avgTds']:.0f} "
              f"turb={water['avgTurbidity']:.1f}")
        if real_weight is not None and HYBRID_MODE:
            print(f"[WEIGHT] Override: may totoong weight ({real_weight:.1f}g sa week "
                  f"{real_week}) pero HYBRID_MODE=True -> stocking weight pa rin.")

    extra_notes = []
    if mode != "real":
        extra_notes.append(f"start = stocking weight {stocking_g:g} g.")
    extra_notes += out_of_range_notes({"currentWeight": start_weight, **water}, model_meta["featureRanges"])

    # Project weight kada linggo mula sa (start_week, start_weight)
    trajectory = project_weights(model, model_meta["features"], water, start_weight, start_week)
    harvest_weight = trajectory[-1][1] if trajectory else start_weight
    print(f"[OK] Projected harvest weight: {harvest_weight:.1f}g "
          f"(mula {start_weight:.1f}g sa week {start_week}, hanggang week {HARVEST_WEEK})")
    projection = projection_fields(start_week, start_weight, "real" if mode == "real" else "stocking",
                                   trajectory, early, extra_notes)

    if early:
        gi_doc.reference.update(projection)
        print(f"[EARLY] Nasulat ang early projection ({len(projection['rfProjectionByWeek'])} points); rfPending pa rin.")
        return

    # Projected survival sa harvest (trend ng completed weeks), fallback current survival
    current_week = (today - cycle_start_day).days // 7 + 1
    projected_survival = project_survival(deaths_by_week, gi["initialStock"], current_week)
    if total_deaths == 0:
        survival_note = "No mortality logged this cycle — survival assumed 100%."
    elif projected_survival is None:
        survival_note = "Survival based on current logged mortality (as-of-date), not final harvest survival."
    else:
        survival_note = f"Survival projected to week {HARVEST_WEEK} at the average weekly death rate so far."

    # Compute yield
    doc_ref, stock, survival, yield_kg = compute_yield(gi_doc, gi, harvest_weight, total_deaths, projected_survival)
    print(f"[OK] YIELD = {stock} x {survival:.1f}% x {harvest_weight:.1f}g / 1000 = {yield_kg:.2f} kg")

    # Isulat pabalik
    write_prediction(doc_ref, harvest_weight, yield_kg, survival, mode, n_readings, survival_note,
                     provenance, extra_notes, projection)

    print("=" * 55)
    print("TAPOS — prediction nasa Firestore growth_indicators")
    print("=" * 55)

if __name__ == "__main__":
    main()
