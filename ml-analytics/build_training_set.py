"""
Bantay Ulang — Real Training Set Builder
=========================================
Ginagawang weekly training rows (parehong columns ng bantay_ulang_810_dataset.csv)
ang totoong data ng kasalukuyang cycle, para ma-validate o ma-retrain ang RF.

SOURCES:
  - Water averages: daily_averages_cache.json — kapareho ng predict_yield.py; ang
    kulang na araw ay bina-backfill dito (hindi naghihintay sa 90-day gate),
    capped sa natitirang SAFETY_THRESHOLD reads ngayong araw.
  - Weight: ulang_growth_records (per-week median, parehong flags ng web reportCleanup.js).
  - Feed rate: ASSUMED (optimal_feed_rate curve) — feedRateAssumed = 1.
  - DO: wala (sensor excluded); ang predict_yield.py ay gumagamit ng FIXED_DO_MG_L.

ROW RULE: may row ang week N kung usable ang weight sa week N AT N+1 (hindi
flagged, >= MIN_WEEK_SAMPLES samples) at may >= MIN_WATER_DAYS live water days
sa week N. weeklyGrowthIncrement = median(N+1) - median(N).

Output: real_training_rows.csv — pinapalitan lang ang rows ng parehong cycleId,
kaya naiipon ang mga cycle sa paglipas ng panahon.
"""

import os
from datetime import date, datetime, timedelta, timezone
import pandas as pd

from predict_yield import (
    STAT_MAP, SAFETY_THRESHOLD, GRACE_DAYS, connect_firestore, fetch_growth_indicators,
    fetch_weights_by_week, load_daily_cache, reconcile_daily_cache, get_missing_dates,
    backfill_missing_days, ph_date, optimal_feed_rate, load_read_counter, save_read_counter,
    weekly_weight_stats, flag_weights, usable_weeks, MIN_WEEK_SAMPLES,
)

OUTPUT_FILE = "real_training_rows.csv"
MIN_WATER_DAYS = 4  # a week needs at least this many live water days to become a row
COLUMNS = [
    "cycleId", "weekNumber", "currentWeight", *STAT_MAP,
    "avgFeedRate", "weeklyGrowthIncrement", "feedRateAssumed", "waterDays",
    "source", "sampleCount", "nextSampleCount", "weightStat",
]

def weekly_water(days, cycle_start_day):
    """Group live cached days into weeks; average per feature weighted by readings kept for it."""
    weeks = {}  # {week: {"sums": {feat: (sum, n)}, "days": int}}
    for iso, day in days.items():
        n = day.get("n", 0)
        if n == 0 or day.get("n_synthetic", 0) > 0:
            continue  # empty or synthetic day — never trained on
        week = (date.fromisoformat(iso) - cycle_start_day).days // 7 + 1
        w = weeks.setdefault(week, {"sums": {}, "days": 0})
        w["days"] += 1
        for feat in STAT_MAP:
            kept = day.get("counts", {}).get(feat, 0)
            if day.get(feat) is not None and kept > 0:
                s, c = w["sums"].get(feat, (0.0, 0))
                w["sums"][feat] = (s + day[feat] * kept, c + kept)

    result = {}
    for week, w in weeks.items():
        if len(w["sums"]) == len(STAT_MAP):  # skip weeks missing any parameter
            result[week] = dict({f: s / c for f, (s, c) in w["sums"].items()}, days=w["days"])
    return result

def build_rows(cycle_id, water_by_week, weights_by_week, stocking_g):
    """One row per week N with usable weights at N and N+1 and at least MIN_WATER_DAYS water days at N."""
    stats = weekly_weight_stats(weights_by_week)
    usable = usable_weeks(stats, flag_weights(stats, stocking_g))
    rows = []
    skipped = {"no usable next week": 0, f"< {MIN_WATER_DAYS} water days": 0}
    for wk in sorted(usable):
        if wk + 1 not in usable:
            skipped["no usable next week"] += 1
            continue
        water = water_by_week.get(wk)
        if water is None or water["days"] < MIN_WATER_DAYS:
            skipped[f"< {MIN_WATER_DAYS} water days"] += 1
            continue
        cur, nxt = stats[wk], stats[wk + 1]
        rows.append({
            "cycleId": cycle_id,
            "weekNumber": wk,
            "currentWeight": round(cur["median"], 3),
            **{f: round(water[f], 3) for f in STAT_MAP},
            "avgFeedRate": round(optimal_feed_rate(cur["median"]), 3),
            "weeklyGrowthIncrement": round(nxt["median"] - cur["median"], 3),
            "feedRateAssumed": 1,
            "waterDays": water["days"],
            "source": "real",
            "sampleCount": cur["n"],
            "nextSampleCount": nxt["n"],
            "weightStat": "median",
        })
    print(f"[ROWS] {len(stats) - len(usable)} week(s) unusable (flagged or < {MIN_WEEK_SAMPLES} samples); "
          + ", ".join(f"{k}: {v}" for k, v in skipped.items()))
    return rows

def save_rows(cycle_id, rows):
    """Replace this cycle's rows in OUTPUT_FILE, keeping other cycles intact."""
    new = pd.DataFrame(rows, columns=COLUMNS)
    if os.path.exists(OUTPUT_FILE):
        old = pd.read_csv(OUTPUT_FILE, dtype={"cycleId": str})
        new = pd.concat([old[old["cycleId"] != cycle_id], new], ignore_index=True)
    new.to_csv(OUTPUT_FILE, index=False)
    return len(new)

def main():
    print("=" * 55)
    print("BANTAY ULANG — REAL TRAINING SET BUILDER")
    print("=" * 55)

    db = connect_firestore()
    gi_doc = fetch_growth_indicators(db)
    gi = gi_doc.to_dict() if gi_doc else {}
    cycle_start = gi.get("cycleStart")
    if cycle_start is None:
        print("[ERROR] Walang growth_indicators.cycleStart — hindi matukoy ang weeks")
        return
    stocking_g = gi.get("stockingWeight")
    if not isinstance(stocking_g, (int, float)) or stocking_g <= 0:
        print("[WARN] Walang stockingWeight — flags gagamit ng lumang 5 + 5 x week cap (mafa-flag ang sub-adult weeks).")

    cycle_start_day = ph_date(cycle_start)
    cycle_id = cycle_start_day.isoformat()
    today = ph_date(datetime.now(timezone.utc))

    # Backfill missing past days (same cache and budget rules as predict_yield.py).
    cache = reconcile_daily_cache(load_daily_cache(), cycle_start)
    missing = get_missing_dates(cache, cycle_start_day, today)
    reads_today = load_read_counter()
    sensor_reads, fetched = backfill_missing_days(
        db, cache, missing, max(0, SAFETY_THRESHOLD - reads_today), today - timedelta(days=GRACE_DAYS))
    if fetched < len(missing):
        print(f"[BACKFILL] {len(missing) - fetched} day(s) pa — partial muna; i-re-run bukas para tumuloy.")

    water_by_week = weekly_water(cache["days"], cycle_start_day)
    weights_by_week, weight_reads = fetch_weights_by_week(db, cycle_start)
    save_read_counter(reads_today + sensor_reads + weight_reads + 1)

    print(f"[OK] Cycle {cycle_id}: {len(water_by_week)} week(s) na may live water data, "
          f"{len(weights_by_week)} week(s) na may weight sample ({weight_reads} records read)")

    rows = build_rows(cycle_id, water_by_week, weights_by_week, stocking_g)
    if not rows:
        print(f"[INFO] Wala pang usable row — kailangan ng >= {MIN_WEEK_SAMPLES} samples sa dalawang magkasunod na linggo "
              f"at >= {MIN_WATER_DAYS} water days.")
        return

    total = save_rows(cycle_id, rows)
    print(f"[OK] {len(rows)} row(s) para sa cycle {cycle_id} -> {OUTPUT_FILE} ({total} total rows)")
    print("[NOTE] avgFeedRate ay assumed (optimal curve), hindi totoong log.")

if __name__ == "__main__":
    main()
