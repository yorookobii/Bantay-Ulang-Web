"""
Synthetic training water conditions vs Cycle 1 real sensor readings (adviser request).

Synthetic: synthetic_v2.csv weekly avgWaterTemp, avgPh, avgTurbidity.
Real: daily means from cycleStart to today, fetched and cleaned with predict_yield.py
(fetch_day_readings + drop_reason, shared daily cache). Writes nothing to Firestore.

Usage:
  python compare_synthetic_real.py          # estimate only, no Firestore reads
  python compare_synthetic_real.py --fetch  # read Firestore, write comparison/ outputs
  python compare_synthetic_real.py --rerender  # redraw figures from comparison/real_daily_means.csv
  python compare_synthetic_real.py --weights   # step 2: growth rule vs real weekly medians (weight records only)
  python compare_synthetic_real.py --freeze    # freeze the RF v2 week-2 forecast (--force to overwrite)
  python compare_synthetic_real.py --rf-week2  # step 3, after the week-2 weigh-in: frozen forecast vs actual
"""
import argparse
import json
import os
import subprocess
from datetime import date, datetime, timedelta, timezone

os.chdir(os.path.dirname(os.path.abspath(__file__)))  # predict_yield paths are relative

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import joblib
import numpy as np
import pandas as pd
import sklearn

from generate_synthetic import GAIN_FLOOR_G, base_gain, water_effect
from predict_yield import (
    DAILY_READ_LIMIT, ESTIMATED_READS_PER_DAY, GRACE_DAYS, PHT, STAT_MAP,
    backfill_missing_days, check_read_guardrail, connect_firestore, fetch_day_readings,
    fetch_growth_indicators, fetch_weights_by_week, flag_weights, get_missing_dates, load_daily_cache,
    load_model, load_read_counter, out_of_range_notes, ph_date, project_weights,
    reconcile_daily_cache, save_daily_cache, save_read_counter, usable_weeks, weekly_weight_stats,
)

SYNTHETIC_FILE = "synthetic_v2.csv"
OUT_DIR = "comparison"
PH_CALIBRATED_FROM = date(2026, 10, 15)  # PHT; probe calibrated Oct 14, first full calibrated day Oct 15
CYCLE1_FROM = date(2026, 10, 13)  # PHT floor so setup days never enter the comparison, even if cycleStart is wrong
V1_MODEL_FILE = "rf_growth_model.joblib"  # RF v1, 8 features, trained on V1_DATASET (notebook), scikit-learn 1.8.0
V1_DATASET = "bantay_ulang_810_dataset.csv"
FORECAST_FILE = os.path.join("comparison", "forecast_week2.json")
CURVES = [("Slow (m=0)", 0.0), ("Average (m=0.5)", 0.5), ("Fast (m=1)", 1.0)]  # generate_synthetic.py curve mix
WEIGHTS_CAPTION = "Week 1 covers ~6 days of growth; sampling noise is similar in size to the expected gain."
REAL_COLOR, SYN_COLOR = "#0d9488", "#64748b"
TITLE = "Synthetic training conditions vs actual pond readings (Cycle 1)"
CAPTION = ("Synthetic temperatures were derived from Cycle 1 sensor readings, so this figure "
           "shows coverage of actual conditions, not independent validation.")

# feature, display name, unit, axis label
PARAMS = [
    ("avgWaterTemp", "Temperature", "°C", "Temperature (°C)"),
    ("avgPh", "pH", "", "pH"),
    ("avgTurbidity", "Turbidity", "NTU", "Turbidity (NTU)"),
]

plt.rcParams.update({"font.family": "Arial", "font.size": 13, "axes.titlesize": 14,
                     "axes.labelsize": 13, "figure.facecolor": "white", "savefig.facecolor": "white"})


def fmt(v, unit, signed=False):
    """Value with one decimal (two for pH) and its unit."""
    digits = 1 if unit else 2
    return (f"{v:+.{digits}f}" if signed else f"{v:.{digits}f}") + (f" {unit}" if unit else "")


def first_day(cycle_start):
    """Later of the cycle start and CYCLE1_FROM (PHT), warning when they differ."""
    start = ph_date(cycle_start)
    if start != CYCLE1_FROM:
        print(f"[WARN] cycleStart {start} differs from CYCLE1_FROM {CYCLE1_FROM}; comparing from {max(start, CYCLE1_FROM)}.")
    return max(start, CYCLE1_FROM)


def cycle_days(first, today):
    """PHT dates from first to today inclusive."""
    return [first + timedelta(days=i) for i in range((today - first).days + 1)]


def estimate():
    """Prints the planned reads from the local cache only (no Firestore)."""
    cache = load_daily_cache()
    if not cache.get("cycleStart"):
        print("[ESTIMATE] No cached cycleStart; run with --fetch (1 read for growth_indicators).")
        return
    cycle_start = datetime.fromisoformat(cache["cycleStart"])
    cache = reconcile_daily_cache(cache, cycle_start)  # in memory only; the file is unchanged
    today = ph_date(datetime.now(timezone.utc))
    missing = get_missing_dates(cache, first_day(cycle_start), today)
    worst = (len(missing) + 1) * ESTIMATED_READS_PER_DAY + 1
    print(f"[ESTIMATE] cycleStart {ph_date(cycle_start)} (cached; Firestore may differ), today {today}")
    print(f"[ESTIMATE] Days to fetch: {len(missing)} completed ({', '.join(d.isoformat() for d in missing) or 'none'}) + today")
    print(f"[ESTIMATE] Worst case {worst:,} reads ({ESTIMATED_READS_PER_DAY}/day guardrail estimate + 1 growth_indicators)")
    print(f"[ESTIMATE] Reads already today: {load_read_counter():,}. Run with --fetch to continue.")


def fetch_real():
    """Daily means per PHT day as a DataFrame (date index), using the shared predict_yield cache."""
    db = connect_firestore()
    gi_doc = fetch_growth_indicators(db)
    if gi_doc is None or gi_doc.to_dict().get("cycleStart") is None:
        raise SystemExit("[ERROR] No growth_indicators cycleStart.")
    cycle_start = gi_doc.to_dict()["cycleStart"]
    today = ph_date(datetime.now(timezone.utc))
    first = first_day(cycle_start)
    cache = reconcile_daily_cache(load_daily_cache(), cycle_start)
    missing = get_missing_dates(cache, first, today)
    if not check_read_guardrail((len(missing) + 1) * ESTIMATED_READS_PER_DAY + 1):
        raise SystemExit("[EXIT] Read guardrail.")

    current = load_read_counter()
    reads, _ = backfill_missing_days(db, cache, missing, DAILY_READ_LIMIT - current, today - timedelta(days=GRACE_DAYS))
    save_daily_cache(cache)
    today_avgs, today_n, today_reads, _, _ = fetch_day_readings(db, today.year, today.month, today.day)
    total = reads + today_reads + 1
    save_read_counter(current + total)
    print(f"[OK] Firestore reads this run: {total:,} (backfill {reads:,}, today {today_reads:,}, growth_indicators 1)")

    rows = []
    for d in cycle_days(first, today):
        day = (today_avgs if today_n else {}) if d == today else cache["days"].get(d.isoformat(), {})
        rows.append({"date": d, **{f: day.get(f) for f, *_ in PARAMS}})
    df = pd.DataFrame(rows).set_index("date").astype(float)
    if get_missing_dates(cache, first, today):
        print("[WARN] Some completed days are still not cached; they show as gaps.")
    return df, today


def synthetic_stats(values):
    return {"syn_mean": values.mean(), "syn_sd": values.std(ddof=1), "syn_min": values.min(),
            "syn_max": values.max(), "syn_p05": np.percentile(values, 5), "syn_p95": np.percentile(values, 95)}


def real_series(real, feat):
    """(used, pre-calibration) daily means for a parameter, NaN days dropped."""
    s = real[feat].dropna()
    if feat != "avgPh":
        return s, s.iloc[:0]
    pre = s.index < PH_CALIBRATED_FROM
    return s[~pre], s[pre]


def gap_table(syn, real):
    rows = []
    for feat, name, unit, _ in PARAMS:
        st = synthetic_stats(syn[feat])
        used, pre = real_series(real, feat)
        inside = used.between(st["syn_p05"], st["syn_p95"])
        rows.append({
            "parameter": name, "unit": unit, **st,
            "real_mean": used.mean(), "real_sd": used.std(ddof=1), "real_min": used.min(), "real_max": used.max(),
            "real_days": len(used), "real_days_inside": int(inside.sum()),
            "pct_days_inside": 100 * inside.mean() if len(used) else np.nan,
            "gap": used.mean() - st["syn_mean"],
            "pre_calibration_days": len(pre),
            "pre_calibration_values": "; ".join(f"{d}: {v:.2f}" for d, v in pre.items()),
        })
    return pd.DataFrame(rows)


def plot_lines(real, table, today, path):
    fig, axes = plt.subplots(3, 1, figsize=(11, 10), sharex=True)
    dates = pd.to_datetime(real.index)
    for ax, (feat, name, unit, label), (_, t) in zip(axes, PARAMS, table.iterrows()):
        ax.axhspan(t.syn_p05, t.syn_p95, color=SYN_COLOR, alpha=0.15, lw=0)
        ax.axhline(t.syn_mean, color=SYN_COLOR, ls="--", lw=2)
        used, pre = real_series(real, feat)
        line = real[feat].where(real.index.isin(used.index))
        ax.plot(dates, line, color=REAL_COLOR, lw=2.5, marker="o", ms=7)
        if len(pre):
            ax.plot(pd.to_datetime(pre.index), pre, ls="none", marker="o", ms=8,
                    mfc="white", mec=REAL_COLOR, mew=2)
            ax.annotate("before calibration", (pd.to_datetime(pre.index[-1]), pre.iloc[-1]),
                        xytext=(10, 0), textcoords="offset points", va="center", fontsize=11, color=REAL_COLOR)
        ax.set_ylabel(label)
        ax.grid(axis="y", color="#e5e7eb")
        ax.spines[["top", "right"]].set_visible(False)
    axes[-1].xaxis.set_major_locator(mdates.DayLocator())
    axes[-1].xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    axes[-1].set_xlabel(f"Date (PHT, {today:%b %d} partial)")
    handles = [Line2D([], [], color=REAL_COLOR, lw=2.5, marker="o", ms=7, label="Real daily mean"),
               Line2D([], [], ls="none", marker="o", ms=8, mfc="white", mec=REAL_COLOR, mew=2, label="Before pH calibration"),
               Line2D([], [], color=SYN_COLOR, ls="--", lw=2, label="Synthetic mean"),
               Patch(color=SYN_COLOR, alpha=0.15, label="Synthetic 5–95% range")]
    fig.suptitle(TITLE, fontsize=16, fontweight="bold", y=0.985)
    fig.legend(handles=handles, loc="upper center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 0.95), fontsize=12)
    fig.text(0.5, 0.012, CAPTION, ha="center", fontsize=11, style="italic", color="#374151", wrap=True)
    fig.tight_layout(rect=(0, 0.035, 1, 0.92))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def strip_offsets(xs, tol, step):
    """Vertical offsets 0, +step, -step, +2step... for dots within tol of an earlier dot, so none overlap."""
    offsets = []
    for i, x in enumerate(xs):
        k = sum(abs(x - xs[j]) < tol for j in range(i))
        offsets.append((k + 1) // 2 * step * (1 if k % 2 else -1))
    return np.array(offsets)


def plot_hist(syn, real, path):
    fig, axes = plt.subplots(1, 3, figsize=(15, 5.5))
    for ax, (feat, name, unit, label) in zip(axes, PARAMS):
        values = syn[feat]
        heights, _, _ = ax.hist(values, bins=30, density=True, color=SYN_COLOR, alpha=0.45, edgecolor="white")
        used, pre = real_series(real, feat)
        xs = np.concatenate([used.to_numpy(), pre.to_numpy()])
        span = max(values.max(), xs.max()) - min(values.min(), xs.min())
        ys = heights.max() * 1.15 + strip_offsets(xs, 0.025 * span, heights.max() * 0.06)
        ax.plot(xs[:len(used)], ys[:len(used)], ls="none", marker="o", ms=9, color=REAL_COLOR, mec="white")
        if len(pre):
            ax.plot(xs[len(used):], ys[len(used):], ls="none", marker="o", ms=9, mfc="white", mec=REAL_COLOR, mew=2)
        ax.set_ylim(0, heights.max() * 1.32)
        ax.set_xlabel(label)
        ax.set_ylabel("Density")
        ax.spines[["top", "right"]].set_visible(False)
    handles = [Patch(color=SYN_COLOR, alpha=0.45, label="Synthetic weekly values (density)"),
               Line2D([], [], ls="none", marker="o", ms=9, color=REAL_COLOR, label="Real daily means"),
               Line2D([], [], ls="none", marker="o", ms=9, mfc="white", mec=REAL_COLOR, mew=2, label="Before pH calibration")]
    fig.suptitle("Synthetic training distribution vs actual daily means (Cycle 1)", fontsize=16, fontweight="bold", y=0.98)
    fig.legend(handles=handles, loc="upper center", ncol=3, frameon=False, bbox_to_anchor=(0.5, 0.92), fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.86))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def print_summary(table):
    print("\n" + "=" * 55)
    for _, t in table.iterrows():
        u = t.unit
        print(f"{t.parameter}: real avg {fmt(t.real_mean, u)} vs synthetic {fmt(t.syn_mean, u)} (gap {fmt(t.gap, u, True)}).")
        print(f"  {t.real_days_inside}/{t.real_days} real days ({t.pct_days_inside:.0f}%) inside the synthetic 5–95% range "
              f"({fmt(t.syn_p05, u)} to {fmt(t.syn_p95, u)}).")
        extra = f"; {t.pre_calibration_days} day(s) before calibration excluded ({t.pre_calibration_values})" if t.pre_calibration_days else ""
        print(f"  Spread: real SD {fmt(t.real_sd, u)} over daily means vs synthetic SD {fmt(t.syn_sd, u)} over weekly values{extra}.")


def week1_water(cache, first):
    """Week-1 water means weighted by kept readings per day (like fetch_today_and_average); pH only from PH_CALIBRATED_FROM."""
    water = {}
    for feat in STAT_MAP:
        total, count = 0.0, 0
        for d in (first + timedelta(days=i) for i in range(7)):
            day = cache["days"].get(d.isoformat(), {})
            n = day.get("counts", {}).get(feat, 0)
            if day.get(feat) is None or not n or (feat == "avgPh" and d < PH_CALIBRATED_FROM):
                continue
            total += day[feat] * n
            count += n
        water[feat] = total / count if count else None
    return water


def cached_week1_water(cycle_start):
    """Week-1 water from the shared daily cache (no reads); stops when the cache is for another cycle or a parameter is missing."""
    cache = load_daily_cache()
    if cache.get("cycleStart") != cycle_start.isoformat():
        raise SystemExit("[STOP] Daily cache is for another cycleStart; run --fetch first.")
    first = first_day(cycle_start)
    water = week1_water(cache, first)
    if None in water.values():
        raise SystemExit(f"[STOP] Missing week-1 water: {[f for f, v in water.items() if v is None]}; run --fetch first.")
    days = [d for d in (first + timedelta(days=i) for i in range(7)) if cache["days"].get(d.isoformat(), {}).get("n")]
    return water, [d.isoformat() for d in days]


def load_cycle_weights(db):
    """Cycle start, stocking weight and weekly weight stats with flags and usable weeks, cleaned like predict_yield.py."""
    gi = fetch_growth_indicators(db).to_dict()
    cycle_start, stock = gi["cycleStart"], gi.get("stockingWeight")
    by_week, reads = fetch_weights_by_week(db, cycle_start)
    save_read_counter(load_read_counter() + reads + 1)
    print(f"[OK] cycleStart {ph_date(cycle_start)}, stocking weight {stock} g, {reads} weight records read (+1 growth_indicators)")
    stats = weekly_weight_stats(by_week)
    flags = flag_weights(stats, stock)
    return {"cycle_start": cycle_start, "stock": stock, "stats": stats, "flags": flags, "usable": usable_weeks(stats, flags)}


def compare_weights(cw):
    """Step 2: generator growth rule (no noise) from the stocking weight with real week-1 water, m = 0, 0.5, 1, vs real weekly medians."""
    stock, stats, flags, usable = cw["stock"], cw["stats"], cw["flags"], cw["usable"]
    if not isinstance(stock, (int, float)) or stock <= 0:
        raise SystemExit("[STOP] growth_indicators has no stockingWeight.")
    water, days = cached_week1_water(cw["cycle_start"])
    effect = water_effect(water)
    print("[INPUT] Week-1 water (" + ", ".join(days) + "): " + ", ".join(f"{f} {v:.2f}" for f, v in water.items())
          + f"; water effect {effect:.3f} (same water applied to weeks 1-4)")

    curves = {}
    for label, m in CURVES:
        w, path = float(stock), [float(stock)]
        for _ in range(4):
            w += max(GAIN_FLOOR_G, base_gain(w, m) * effect)
            path.append(w)
        curves[label] = path
    rows = []
    for week in range(5):
        s = stats.get(week)
        rows.append({"week": week, **{label: path[week] for label, path in curves.items()},
                     "real_median": s["median"] if s else np.nan, "real_n": s["n"] if s else 0,
                     "usable": week in usable, "flag": flags.get(week, "")})
    table = pd.DataFrame(rows)
    os.makedirs(OUT_DIR, exist_ok=True)
    table.round(3).to_csv(os.path.join(OUT_DIR, "weights_vs_synthetic.csv"), index=False, encoding="utf-8-sig")
    print("\n" + table.round(2).to_string(index=False))

    fig, ax = plt.subplots(figsize=(10, 6))
    for (label, _), color, ls in zip(CURVES, ("#94a3b8", SYN_COLOR, "#334155"), (":", "--", "-.")):
        ax.plot(table.week, table[label], color=color, ls=ls, lw=2.5, label=label)
    for _, r in table[table.real_n > 0].iterrows():
        filled = bool(r.usable)
        ax.plot(r.week, r.real_median, "o", ms=10, color=REAL_COLOR, mfc=REAL_COLOR if filled else "white", mew=2)
        ax.annotate(f"n={r.real_n}" + ("" if filled else " (not usable)"), (r.week, r.real_median),
                    xytext=(10, -4), textcoords="offset points", fontsize=12, color=REAL_COLOR)
    ax.plot([], [], "o", ms=10, color=REAL_COLOR, label="Real weekly median")
    ax.set_xticks(range(5))
    ax.set_xlabel("Week (0 = stocking)")
    ax.set_ylabel("Weight (g)")
    ax.grid(axis="y", color="#e5e7eb")
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, loc="upper left")
    fig.suptitle("Synthetic growth rule vs actual weekly medians (Cycle 1)", fontsize=16, fontweight="bold")
    fig.text(0.5, 0.015, WEIGHTS_CAPTION, ha="center", fontsize=11, style="italic", color="#374151")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(os.path.join(OUT_DIR, "fig_weights_vs_synthetic.png"), dpi=150)
    plt.close(fig)
    print(f"\n[OK] Wrote {OUT_DIR}/weights_vs_synthetic.csv, fig_weights_vs_synthetic.png")


def git_state():
    """(HEAD commit hash, whether ml-analytics has uncommitted changes), or (None, None) without git."""
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "."], capture_output=True, text=True, check=True).stdout.strip())
        return head, dirty
    except (OSError, subprocess.CalledProcessError):
        return None, None


def freeze_forecast(cw, force=False):
    """Writes FORECAST_FILE: RF v2 week-2 weight from the week-1 median and week-1 water, frozen before the week-2 weigh-in."""
    if os.path.exists(FORECAST_FILE) and not force:
        raise SystemExit(f"[STOP] {FORECAST_FILE} already exists; pass --force to overwrite it.")
    stats, usable, flags = cw["stats"], cw["usable"], cw["flags"]
    if 1 not in stats:
        raise SystemExit(f"[STOP] No week-1 weigh-in; found weeks {sorted(stats)}.")
    if 1 not in usable:
        print(f"[WARN] Week 1 is not usable (n={stats[1]['n']}, flag: {flags.get(1) or 'none'}); freezing anyway, marked week1Usable=false.")
    water, days = cached_week1_water(cw["cycle_start"])
    v2, meta = load_model()
    if v2 is None:
        raise SystemExit("[STOP] RF v2 did not load.")
    start = stats[1]["median"]
    # First projected step: the week-1 median plus one week of predicted gain.
    pred = project_weights(v2, meta["features"], water, start, start_week=1)[0][1]
    commit, dirty = git_state()
    forecast = {
        "createdAt": datetime.now(PHT).isoformat(timespec="seconds"),
        "gitCommit": commit,
        "gitDirty": dirty,
        "model": {"file": meta["modelFile"], "trainedSklearn": meta["versions"]["sklearn"], "installedSklearn": sklearn.__version__},
        "cycleStart": ph_date(cw["cycle_start"]).isoformat(),
        "stockingWeightG": cw["stock"],
        "inputs": {"week1MedianG": round(start, 3), "week1N": stats[1]["n"], "week1Usable": 1 in usable,
                   "water": {f: round(v, 3) for f, v in water.items()}, "waterDays": days,
                   "phFrom": PH_CALIBRATED_FROM.isoformat()},
        "outOfRangeNotes": out_of_range_notes({f: water[f] for f in meta["features"] if f != "currentWeight"} | {"currentWeight": start},
                                              meta["featureRanges"]),
        "rfV2Week2G": round(pred, 3),
        "pondTrend": None,
        "pondTrendNote": ("Not available: the pond trend needs 2 usable weeks (stocking + weeks 1 and 2) and only week 1 exists; "
                          "it is computed in the web app (pondTrend.js), not in Python."),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(FORECAST_FILE, "w", encoding="utf-8") as f:
        json.dump(forecast, f, indent=2, ensure_ascii=False)
    print(json.dumps(forecast, indent=2, ensure_ascii=False))
    print(f"[OK] Froze {FORECAST_FILE}")


def compare_rf_week2():
    """Step 3, after the week-2 weigh-in: frozen RF v2 forecast and RF v1 (same frozen inputs, DO imputed) vs the actual week-2 median."""
    if not os.path.exists(FORECAST_FILE):
        raise SystemExit(f"[STOP] No {FORECAST_FILE}; run --freeze before the week-2 weigh-in.")
    with open(FORECAST_FILE, encoding="utf-8") as f:
        forecast = json.load(f)
    cw = load_cycle_weights(connect_firestore())
    if ph_date(cw["cycle_start"]).isoformat() != forecast["cycleStart"]:
        raise SystemExit(f"[STOP] cycleStart changed since the forecast ({forecast['cycleStart']} vs {ph_date(cw['cycle_start'])}).")
    if 2 not in cw["stats"]:
        raise SystemExit(f"[STOP] No week-2 weigh-in yet; found weeks {sorted(cw['stats'])}.")
    actual, n2 = cw["stats"][2]["median"], cw["stats"][2]["n"]
    if 2 not in cw["usable"]:
        print(f"[WARN] Week 2 is not usable (n={n2}, flag: {cw['flags'].get(2) or 'none'}).")

    inputs = forecast["inputs"]
    do = float(pd.read_csv(V1_DATASET)["avgDissolvedOxygen"].median())
    print(f"[IMPUTED] v1 avgDissolvedOxygen = {do:.3f} mg/L, the training median of {V1_DATASET} (no DO sensor in Cycle 1).")
    v1 = joblib.load(V1_MODEL_FILE)  # 1.8.0 pickle under 1.9.0: InconsistentVersionWarning is expected
    v1_pred = project_weights(v1, list(v1.feature_names_in_), {**inputs["water"], "avgDissolvedOxygen": do},
                              inputs["week1MedianG"], start_week=1)[0][1]
    print(f"[INPUT] Frozen {forecast['createdAt']} at {forecast['gitCommit']}: week-1 median {inputs['week1MedianG']:.2f} g "
          f"(n={inputs['week1N']}); actual week-2 median {actual:.2f} g (n={n2}).")
    for name, pred in (("RF v2 (frozen forecast)", forecast["rfV2Week2G"]), ("RF v1 (8 features, DO imputed)", v1_pred)):
        print(f"{name}: predicted week 2 {pred:.2f} g vs actual {actual:.2f} g "
              f"(error {pred - actual:+.2f} g, {100 * (pred - actual) / actual:+.1f}%)")


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--fetch", action="store_true", help="read Firestore and write outputs")
    parser.add_argument("--rerender", action="store_true", help="redraw both figures from the saved daily means, no reads")
    parser.add_argument("--weights", action="store_true", help="step 2: generator growth rule vs real weekly medians")
    parser.add_argument("--freeze", action="store_true", help="freeze the RF v2 week-2 forecast to comparison/forecast_week2.json")
    parser.add_argument("--force", action="store_true", help="with --freeze, overwrite an existing forecast")
    parser.add_argument("--rf-week2", action="store_true", help="step 3, after the week-2 weigh-in: frozen forecast vs actual week 2")
    args = parser.parse_args()
    if args.rf_week2:
        compare_rf_week2()
        return
    if args.weights or args.freeze:
        if args.freeze and os.path.exists(FORECAST_FILE) and not args.force:
            raise SystemExit(f"[STOP] {FORECAST_FILE} already exists; pass --force to overwrite it.")
        cw = load_cycle_weights(connect_firestore())
        if args.weights:
            compare_weights(cw)
        if args.freeze:
            freeze_forecast(cw, args.force)
        return
    if not (args.fetch or args.rerender):
        estimate()
        return

    syn = pd.read_csv(SYNTHETIC_FILE)
    syn = syn[syn["source"] == "synthetic"]
    if args.rerender:
        real = pd.read_csv(os.path.join(OUT_DIR, "real_daily_means.csv"), index_col="date", encoding="utf-8-sig")
        real.index = pd.to_datetime(real.index).date
        today = real.index[-1]
        plot_lines(real, gap_table(syn, real), today, os.path.join(OUT_DIR, "fig_water_lines.png"))
        plot_hist(syn, real, os.path.join(OUT_DIR, "fig_water_hist.png"))
        print(f"[OK] Redrew both figures from {OUT_DIR}/real_daily_means.csv (no Firestore reads); CSVs unchanged.")
        return
    real, today = fetch_real()
    table = gap_table(syn, real)

    os.makedirs(OUT_DIR, exist_ok=True)
    real.round(3).to_csv(os.path.join(OUT_DIR, "real_daily_means.csv"), encoding="utf-8-sig")
    table.round(3).to_csv(os.path.join(OUT_DIR, "water_gap.csv"), index=False, encoding="utf-8-sig")
    plot_lines(real, table, today, os.path.join(OUT_DIR, "fig_water_lines.png"))
    plot_hist(syn, real, os.path.join(OUT_DIR, "fig_water_hist.png"))
    print_summary(table)
    print(f"\n[OK] Wrote {OUT_DIR}/water_gap.csv, real_daily_means.csv, fig_water_lines.png, fig_water_hist.png")


if __name__ == "__main__":
    main()
