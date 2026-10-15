"""
Bantay Ulang — Real Training Set Builder
=========================================
Ginagawang weekly training rows (parehong columns ng bantay_ulang_810_dataset.csv)
ang totoong data ng kasalukuyang cycle, para ma-validate o ma-retrain ang RF.

SOURCES:
  - Water averages: daily_averages_cache.json — kapareho ng predict_yield.py; ang
    kulang na araw ay bina-backfill dito (hindi naghihintay sa 90-day gate),
    capped sa natitirang SAFETY_THRESHOLD reads ngayong araw.
  - Weight: ulang_growth_records (per-week average, parehong bucketing ng web).
  - Feed rate: ASSUMED (optimal_feed_rate curve) — feedRateAssumed = 1.

ROW RULE: may row ang week N kung may weight sample sa week N AT N+1, at may
live water data sa week N. weeklyGrowthIncrement = avg(N+1) - avg(N).

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
)

OUTPUT_FILE = "real_training_rows.csv"
COLUMNS = [
    "cycleId", "weekNumber", "currentWeight", *STAT_MAP,
    "avgFeedRate", "weeklyGrowthIncrement", "feedRateAssumed", "waterDays",
]

def weekly_water(days, cycle_start_day):
    """Group live cached days into weeks; reading-count-weighted average per feature."""
    weeks = {}  # {week: {"sums": {feat: (sum, n)}, "days": int}}
    for iso, day in days.items():
        n = day.get("n", 0)
        if n == 0 or day.get("n_synthetic", 0) > 0:
            continue  # empty or synthetic day — never trained on
        week = (date.fromisoformat(iso) - cycle_start_day).days // 7 + 1
        w = weeks.setdefault(week, {"sums": {}, "days": 0})
        w["days"] += 1
        for feat in STAT_MAP:
            if day.get(feat) is not None:
                s, c = w["sums"].get(feat, (0.0, 0))
                w["sums"][feat] = (s + day[feat] * n, c + n)

    result = {}
    for week, w in weeks.items():
        if len(w["sums"]) == len(STAT_MAP):  # skip weeks missing any parameter
            result[week] = dict({f: s / c for f, (s, c) in w["sums"].items()}, days=w["days"])
    return result

def build_rows(cycle_id, water_by_week, weights_by_week):
    """One row per week N with weights at N and N+1 plus water data at N."""
    avg_w = {wk: sum(v) / len(v) for wk, v in weights_by_week.items()}
    rows = []
    for wk in sorted(avg_w):
        if wk + 1 not in avg_w or wk not in water_by_week:
            continue
        water = water_by_week[wk]
        rows.append({
            "cycleId": cycle_id,
            "weekNumber": wk,
            "currentWeight": round(avg_w[wk], 3),
            **{f: round(water[f], 3) for f in STAT_MAP},
            "avgFeedRate": round(optimal_feed_rate(avg_w[wk]), 3),
            "weeklyGrowthIncrement": round(avg_w[wk + 1] - avg_w[wk], 3),
            "feedRateAssumed": 1,
            "waterDays": water["days"],
        })
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
    cycle_start = gi_doc.to_dict().get("cycleStart") if gi_doc else None
    if cycle_start is None:
        print("[ERROR] Walang growth_indicators.cycleStart — hindi matukoy ang weeks")
        return

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

    rows = build_rows(cycle_id, water_by_week, weights_by_week)
    if not rows:
        print("[INFO] Wala pang usable row — kailangan ng weight sample sa dalawang magkasunod na linggo.")
        return

    total = save_rows(cycle_id, rows)
    print(f"[OK] {len(rows)} row(s) para sa cycle {cycle_id} -> {OUTPUT_FILE} ({total} total rows)")
    print("[NOTE] avgFeedRate ay assumed (optimal curve), hindi totoong log.")

if __name__ == "__main__":
    main()
