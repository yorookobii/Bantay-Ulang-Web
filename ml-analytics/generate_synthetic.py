"""
Bantay Ulang — Synthetic Training Set v2 (literature growth curves)
====================================================================
Gumagawa ng weekly rows para sa RF v2 (2–125 g, walang DO, walang weekNumber feature).

GROWTH: weight-driven. Sa bawat timbang, kinukuha ang 7-day gain sa FAST at SLOW
curve (hinahanap ang posisyon sa curve gamit ang timbang, hindi ang week), tapos
slow + m x (fast - slow) kung saan m ~ U(0, 1) kada cycle.

WATER: temperature at TDS ay galing sa totoong readings export (dumaan sa parehong
drop_reason ng predict_yield.py); pH at turbidity ay galing sa plausible ranges
dahil hindi pa calibrated ang pH probe at madalas nasa maintenance ang turbidity probe.

Output: synthetic_v2.csv + synthetic_v2.json (settings, sources, readings date range).
"""

import argparse
import json
from datetime import datetime
import numpy as np
import pandas as pd

from predict_yield import drop_reason, optimal_feed_rate

DEFAULT_READINGS = "bantay-ulang_water-quality_2026-10-10_2026-10-17.xlsx"
OUTPUT_FILE = "synthetic_v2.csv"
OUTPUT_META_FILE = "synthetic_v2.json"
TEMP_COLUMN, TDS_COLUMN, TIME_COLUMN = "Water Temperature (°C)", "TDS (ppm)", "Date and Time"

GROWOUT_DAYS = 150
MAX_WEIGHT_G = 125.0
STOCK_MIN_G, STOCK_MAX_G = 2.0, 50.0

# Ling (FAO), Penang ponds: (day, weight g).
FAST_CURVE = [(1, 2.0), (30, 4.5), (60, 10.0), (90, 25.0), (120, 60.0), (150, 100.0), (180, 125.0)]
# Jain, Gupta & Singh 2008, LRRD 20(7), feeding-schedule weights; midpoints of each day and weight range.
SLOW_CURVE = [(15, 1.25), (50, 4.25), (70, 7.5), (90, 12.5), (110, 18.5), (130, 26.0), (150, 35.0), (170, 47.5)]
CURVE_SOURCES = [
    "Ling, S.W. (FAO), Penang pond growth: 2 g d1 to 125 g at 6 months (fast curve).",
    "Jain, Gupta & Singh 2008, Livestock Research for Rural Development 20(7), feeding-schedule weights (slow curve).",
    "New, M.B. 2002, FAO Fisheries Technical Paper 428: optimal temperature 28-31 C, pH 7.0-8.5.",
]

# Water effects multiply weekly growth: 1.0 inside the band, falling per unit outside it, never below the floor.
TEMP_BAND = (28.0, 31.0, 0.08, 0.2)          # MODEL ASSUMPTION: -0.08 per C outside New 2002 optimum, floor 0.2
PH_BAND = (7.0, 8.5, 0.15, 0.3)              # MODEL ASSUMPTION: -0.15 per pH unit outside New 2002 optimum, floor 0.3
TDS_BAND = (-np.inf, 500.0, 0.0002, 0.9)     # MODEL ASSUMPTION: -0.02 per 100 ppm above 500 ppm, floor 0.9
TURBIDITY_BAND = (-np.inf, 30.0, 0.002, 0.9) # MODEL ASSUMPTION: -0.002 per NTU above 30 NTU, floor 0.9

TEMP_BASE_RANGE_C = (24.0, 34.0)  # MODEL ASSUMPTION: per-cycle base temperature, uniform, plus the real readings' within-cycle variation
PH_RANGE = (6.0, 10.0)       # weekly mean pH, uniform (covers observed probe values plus stress on both sides)
TURBIDITY_RANGE = (5.0, 60.0)  # weekly mean turbidity NTU, uniform
READINGS_PER_WEEK_SAMPLE = 144  # contiguous block of readings (about one day) averaged into a week's value
NOISE_SD, NOISE_CLIP = 0.08, (0.75, 1.25)  # MODEL ASSUMPTION: multiplicative weekly noise
GAIN_FLOOR_G = 0.1           # weekly growth never below this; molting weight dips are ignored

def _weight_at(curve, day):
    """Weight on the curve at a day, extended linearly past the last point with the last slope."""
    days, weights = zip(*curve)
    if day <= days[-1]:
        return float(np.interp(day, days, weights))
    slope = (weights[-1] - weights[-2]) / (days[-1] - days[-2])
    return weights[-1] + slope * (day - days[-1])

def _day_at(curve, weight):
    """Day on the curve where it reaches a weight, extended linearly past the last point."""
    days, weights = zip(*curve)
    if weight <= weights[-1]:
        return float(np.interp(weight, weights, days))
    slope = (weights[-1] - weights[-2]) / (days[-1] - days[-2])
    return days[-1] + (weight - weights[-1]) / slope

def curve_gain(curve, weight, days=7):
    """Gain over `days` starting from `weight`, using the curve's position at that weight."""
    return _weight_at(curve, _day_at(curve, weight) + days) - weight

def base_gain(weight, m):
    """Weekly gain between the slow and fast curves; slow is clamped to never exceed fast."""
    fast = curve_gain(FAST_CURVE, weight)
    slow = min(curve_gain(SLOW_CURVE, weight), fast)
    return slow + m * (fast - slow)

def band_effect(value, band):
    """Growth multiplier for one water parameter."""
    low, high, per_unit, floor = band
    return max(floor, 1.0 - per_unit * max(low - value, 0.0, value - high))

def water_effect(water):
    """Combined multiplier from all four water parameters."""
    return (band_effect(water["avgWaterTemp"], TEMP_BAND) * band_effect(water["avgPh"], PH_BAND)
            * band_effect(water["avgTds"], TDS_BAND) * band_effect(water["avgTurbidity"], TURBIDITY_BAND))

def load_readings(path):
    """Temperature and TDS from a CSV/XLSX export, after the predict_yield.py sanity filter."""
    df = pd.read_excel(path) if path.lower().endswith((".xlsx", ".xls")) else pd.read_csv(path)
    df = df[[TIME_COLUMN, TEMP_COLUMN, TDS_COLUMN]].dropna()
    keep = [drop_reason("avgWaterTemp", t, ts.date()) is None and drop_reason("avgTds", s, ts.date()) is None
            for ts, t, s in zip(pd.to_datetime(df[TIME_COLUMN]), df[TEMP_COLUMN], df[TDS_COLUMN])]
    df = df[keep].sort_values(TIME_COLUMN).reset_index(drop=True)
    times = pd.to_datetime(df[TIME_COLUMN])
    info = {"file": path, "rows": len(df), "from": times.min().isoformat() + "+08:00", "to": times.max().isoformat() + "+08:00"}
    return df[TEMP_COLUMN].to_numpy(float), df[TDS_COLUMN].to_numpy(float), info

def sample_week(rng, temps, tds, temp_offset):
    """One week's water: real temperature/TDS block means (temperature moved to the cycle's base), pH and turbidity from ranges."""
    block = min(READINGS_PER_WEEK_SAMPLE, len(temps))
    start = rng.integers(0, len(temps) - block + 1)
    return {
        "avgWaterTemp": float(temps[start:start + block].mean()) + temp_offset,
        "avgPh": float(rng.uniform(*PH_RANGE)),
        "avgTds": float(tds[start:start + block].mean()),
        "avgTurbidity": float(rng.uniform(*TURBIDITY_RANGE)),
    }

def simulate(n_cycles, seed, temps, tds):
    """Weekly rows for n_cycles cycles, each running until GROWOUT_DAYS or MAX_WEIGHT_G."""
    rng = np.random.default_rng(seed)
    rows = []
    for c in range(1, n_cycles + 1):
        stock = float(rng.uniform(STOCK_MIN_G, STOCK_MAX_G))
        m = float(rng.uniform(0.0, 1.0))
        # Real sample minus the real mean, added to this cycle's base temperature.
        temp_offset = float(rng.uniform(*TEMP_BASE_RANGE_C)) - float(temps.mean())
        weight = stock
        for week in range(1, GROWOUT_DAYS // 7 + 1):
            if weight >= MAX_WEIGHT_G:
                break
            water = sample_week(rng, temps, tds, temp_offset)
            noise = float(np.clip(rng.normal(1.0, NOISE_SD), *NOISE_CLIP))
            gain = max(GAIN_FLOOR_G, base_gain(weight, m) * water_effect(water) * noise)
            rows.append({
                "cycleId": f"syn-{c:03d}",
                "weekNumber": week,
                "currentWeight": round(weight, 3),
                **{k: round(v, 3) for k, v in water.items()},
                "avgFeedRate": round(optimal_feed_rate(weight), 3),
                "weeklyGrowthIncrement": round(gain, 3),
                "source": "synthetic",
                "stockingWeight": round(stock, 3),
            })
            weight += gain
    return pd.DataFrame(rows)

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic_v2.csv from literature growth curves.")
    parser.add_argument("--readings", default=DEFAULT_READINGS, help="real readings export (CSV or XLSX)")
    parser.add_argument("--cycles", type=int, default=300)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    temps, tds, readings_info = load_readings(args.readings)
    print(f"[OK] Readings: {readings_info['rows']} rows, {readings_info['from']} to {readings_info['to']}")
    df = simulate(args.cycles, args.seed, temps, tds)
    df.to_csv(OUTPUT_FILE, index=False)

    meta = {
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "cycles": args.cycles, "rows": len(df), "seed": args.seed,
        "readings": readings_info,
        "curveSources": CURVE_SOURCES,
        "settings": {
            "growoutDays": GROWOUT_DAYS, "maxWeightG": MAX_WEIGHT_G, "stockingRangeG": [STOCK_MIN_G, STOCK_MAX_G],
            "fastCurve": FAST_CURVE, "slowCurve": SLOW_CURVE,
            "tempBand": TEMP_BAND, "phBand": PH_BAND, "tdsBand": [None, *TDS_BAND[1:]], "turbidityBand": [None, *TURBIDITY_BAND[1:]],
            "tempBaseRangeC": TEMP_BASE_RANGE_C, "phRange": PH_RANGE, "turbidityRange": TURBIDITY_RANGE,
            "readingsPerWeekSample": READINGS_PER_WEEK_SAMPLE, "noiseSd": NOISE_SD, "noiseClip": NOISE_CLIP,
            "gainFloorG": GAIN_FLOOR_G,
        },
    }
    with open(OUTPUT_META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[OK] {len(df)} rows, {df['cycleId'].nunique()} cycles -> {OUTPUT_FILE} (+ {OUTPUT_META_FILE})")

if __name__ == "__main__":
    main()
