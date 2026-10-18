"""
Synthetic training water conditions vs Cycle 1 real sensor readings (adviser request).

Synthetic: synthetic_v2.csv weekly avgWaterTemp, avgPh, avgTurbidity.
Real: daily means from cycleStart to today, fetched and cleaned with predict_yield.py
(fetch_day_readings + drop_reason, shared daily cache). Writes nothing to Firestore.

Usage:
  python compare_synthetic_real.py          # estimate only, no Firestore reads
  python compare_synthetic_real.py --fetch  # read Firestore, write comparison/ outputs
  python compare_synthetic_real.py --rerender  # redraw figures from comparison/real_daily_means.csv
"""
import argparse
import os
from datetime import date, datetime, timedelta, timezone

os.chdir(os.path.dirname(os.path.abspath(__file__)))  # predict_yield paths are relative

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import numpy as np
import pandas as pd

from predict_yield import (
    DAILY_READ_LIMIT, ESTIMATED_READS_PER_DAY, GRACE_DAYS,
    backfill_missing_days, check_read_guardrail, connect_firestore, fetch_day_readings,
    fetch_growth_indicators, get_missing_dates, load_daily_cache, load_read_counter,
    ph_date, reconcile_daily_cache, save_daily_cache, save_read_counter,
)

SYNTHETIC_FILE = "synthetic_v2.csv"
OUT_DIR = "comparison"
PH_CALIBRATED_FROM = date(2026, 10, 15)  # PHT; probe calibrated Oct 14, first full calibrated day Oct 15
CYCLE1_FROM = date(2026, 10, 13)  # PHT floor so setup days never enter the comparison, even if cycleStart is wrong
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


def compare_weights():
    """Step 2: synthetic cycle 1 weights vs actual weekly medians (fetch_weights_by_week, weekly_weight_stats)."""
    raise NotImplementedError("after the Oct 20 weigh-in")


def compare_rf_week2():
    """Step 3: RF week-2 prediction (project_weights) vs the actual week-2 median."""
    raise NotImplementedError("after the Oct 20 weigh-in")


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--fetch", action="store_true", help="read Firestore and write outputs")
    parser.add_argument("--rerender", action="store_true", help="redraw both figures from the saved daily means, no reads")
    args = parser.parse_args()
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
