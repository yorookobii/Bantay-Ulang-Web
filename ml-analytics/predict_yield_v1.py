"""
Bantay Ulang — RF v1 Yield Prediction, DEMO PROJECT ONLY
=========================================================
Runs RF v1 (rf_growth_model.joblib, 8 inputs, notebook bantay_ulang_ml.ipynb) on the
demo project (bantay-ulang-demo) and writes the SAME growth_indicators fields as
predict_yield.py, plus rfModelVersion "v1", so the web needs no changes. The live
project stays on v2 via predict_yield.py, which this script does not modify.

  python predict_yield_v1.py --project bantay-ulang-demo            # read + write the demo project
  python predict_yield_v1.py --project bantay-ulang-demo --offline  # no Firestore: seed_demo.py inputs, print fields

Hard guard: --project accepts only bantay-ulang-demo, and the key, project and client are
checked again by predict_yield.connect_firestore before any read.

Reuses predict_yield.py helpers with v1 state: STAT_MAP adds DO, own daily cache
(daily_averages_cache.demo-v1.json), shared demo read counter (read_counter.demo.json).
Feed rate uses the notebook's linear curve (the one v1 was trained around), not SEAFDEC.

Loads the model read-only; never runs or imports the notebook (its cell 5 overwrites the model).
NOT AN ACCURACY TEST: the demo cycle is cycle 1 of the 810-row set v1 was trained on.
"""

import argparse
import io
import contextlib
import warnings
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
import pandas as pd
from firebase_admin import firestore
from sklearn.exceptions import InconsistentVersionWarning
from sklearn.metrics import r2_score
from sklearn.model_selection import train_test_split

import predict_yield as py

DEMO_ONLY = py.DEMO_PROJECT
MODEL_FILE = "rf_growth_model.joblib"
DATASET = "bantay_ulang_810_dataset.csv"
TARGET = "weeklyGrowthIncrement"
EXPECTED_TEST_R2 = 0.7902  # notebook cell 4: 80/20 split, random_state=42
OFFLINE_WEEKS = 15         # seed_demo.py --weeks default
MODEL_VERSION = "v1"
# Notebook optimal_conditions, used only when there is no water data (test mode).
V1_FALLBACK = {"avgWaterTemp": 29.0, "avgPh": 7.6, "avgDissolvedOxygen": 6.5, "avgTds": 250.0, "avgTurbidity": 12.0}
PROJECTION_NOTE = ("RF v1 (8 inputs, trained on the 810-row synthetic set; this demo cycle is in its training data, "
                   "in-sample, not an accuracy result). Weeks 19–21 and weights above 33 g are outside v1's training range.")
MODE_NOTES = {
    "test": "Test-mode: assumed optimal conditions (walang readings pa)",
    "hybrid": "Hybrid: synthetic water params, stocking-weight biomass, notebook v1 feed curve",
    "real": "Real biomass weight + synthetic water params; feed via notebook v1 curve",
}


def use_v1_state():
    """Points predict_yield's module state at v1: DO in STAT_MAP, own cache, shared demo counter."""
    py.STAT_MAP = {**py.STAT_MAP, "avgDissolvedOxygen": "oxygenLevelMgL"}
    py.CACHE_VERSION = 101  # differs from v2's, so a v2-shaped cache file would be cleared
    py.DAILY_CACHE_FILE = "daily_averages_cache.demo-v1.json"
    py.READ_COUNTER_FILE = "read_counter.demo.json"


def notebook_feed_rate(weight):
    """Notebook cell 2 optimal_feed_rate (% body weight/day): 10 at <= 2 g, linear to 5 at >= 25 g."""
    if weight <= 2:
        return 10.0
    if weight >= 25:
        return 5.0
    return 10.0 - (weight - 2) * (5.0 / 23.0)


def load_v1():
    """(model, features, featureRanges) after the R2 self-check; aborts on mismatch. Read-only load."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        model = joblib.load(MODEL_FILE)
    version_warnings = [w for w in caught if issubclass(w.category, InconsistentVersionWarning)]
    if version_warnings:
        print(f"[WARN] {str(version_warnings[0].message).split('. ')[0]}. "
              f"({len(version_warnings)} InconsistentVersionWarnings, shown once; {len(caught) - len(version_warnings)} other load warnings silenced)")
    features = list(model.feature_names_in_)
    df = pd.read_csv(DATASET)
    _, X_test, _, y_test = train_test_split(df[features], df[TARGET], test_size=0.20, random_state=42)
    r2 = r2_score(y_test, model.predict(X_test))
    if round(r2, 4) != EXPECTED_TEST_R2:
        raise SystemExit(f"[STOP] v1 self-check failed: test R2 {r2:.4f} != {EXPECTED_TEST_R2} — model or dataset changed.")
    print(f"[OK] v1 self-check: test R2 {r2:.4f} on {len(X_test)} held-out rows; features {features}")
    ranges = {f: (float(df[f].min()), float(df[f].max())) for f in features}
    return model, features, ranges


def project_v1(model, features, water, start_weight, start_week):
    """[(week, weight)] from start_week to HARVEST_WEEK, one v1 growth step per week."""
    weight, trajectory = start_weight, []
    for wk in range(start_week, py.HARVEST_WEEK + 1):
        row = {"weekNumber": wk, "currentWeight": weight, **water, "avgFeedRate": notebook_feed_rate(weight)}
        weight += float(model.predict(pd.DataFrame([row])[features])[0])
        trajectory.append((wk, weight))
    return trajectory


def compute(model, features, ranges, gi, water, n_readings, provenance, real, deaths_by_week, total_deaths, today, early):
    """Fields predict_yield.py would write (full payload, or rfProjection* only when early); None if early without water."""
    stocking_g = gi["stockingWeight"]
    real_weight, real_week = real
    if water is None or any(v is None for v in water.values()):
        if early:
            return None
        water, mode, n_readings, provenance = dict(V1_FALLBACK), "test", 0, None
        start_weight, start_week = stocking_g, 1
    elif real_weight is not None:
        mode, start_weight, start_week = "real", real_weight, real_week + 1
    else:
        mode, start_weight, start_week = "hybrid", stocking_g, 1

    extra_notes = [] if mode == "real" else [f"start = stocking weight {stocking_g:g} g."]
    extra_notes += py.out_of_range_notes({"currentWeight": start_weight, **water}, ranges)
    trajectory = project_v1(model, features, water, start_weight, start_week)
    harvest_weight = trajectory[-1][1] if trajectory else start_weight
    fields = py.projection_fields(start_week, start_weight, "real" if mode == "real" else "stocking",
                                  trajectory, early, [PROJECTION_NOTE, *extra_notes])
    fields["rfModelVersion"] = MODEL_VERSION
    if early:
        return fields

    current_week = (today - py.ph_date(gi["cycleStart"])).days // 7 + 1
    projected = py.project_survival(deaths_by_week, gi["initialStock"], current_week)
    if total_deaths == 0:
        survival_note = "No mortality logged this cycle — survival assumed 100%."
    elif projected is None:
        survival_note = "Survival based on current logged mortality (as-of-date), not final harvest survival."
    else:
        survival_note = f"Survival projected to week {py.HARVEST_WEEK} at the average weekly death rate so far."
    stock = gi["initialStock"]
    survival = projected if projected is not None else max(0.0, (stock - total_deaths) / stock * 100.0)
    return {
        "rfProjectedWeight": round(harvest_weight, 2),
        "rfProjectedYield": round(stock * (survival / 100.0) * harvest_weight / 1000.0, 3),
        "rfProjectedSurvival": round(survival, 2),
        "rfMode": mode,
        "rfReadingsUsed": n_readings,
        "rfWaterSource": "synthetic",  # demo readings are seeded, never sensor data
        "rfWaterFrom": provenance["from"] if provenance else None,
        "rfWaterTo": provenance["to"] if provenance else None,
        "rfUpdatedAt": firestore.SERVER_TIMESTAMP,
        "rfNote": " ".join([MODE_NOTES[mode], survival_note, *extra_notes]),
        "rfPending": False,
        "rfDaysUntilAvailable": None,
        **fields,
    }


def offline_inputs():
    """The inputs predict would read after seed_demo.py --write, built from seed_demo.build() with no Firestore."""
    import seed_demo
    with contextlib.redirect_stdout(io.StringIO()):
        rows = seed_demo.load_cycle()
    now = datetime.now(py.PHT).replace(minute=0, second=0, microsecond=0)
    user = lambda role: {"uid": f"<{role}-uid>", "email": f"<{role}-email>", "name": role}
    docs, start, readings, _ = seed_demo.build(rows, OFFLINE_WEEKS, now, user("admin"), user("tech"), np.random.default_rng(42))
    gi = dict(docs)["growth_indicators/demo-cycle"]
    start_day = py.ph_date(start)

    by_week, deaths_by_week, total_deaths = {}, {}, 0
    for path, d in docs:
        if path.startswith("ulang_growth_records/"):
            by_week.setdefault((py.ph_date(d["createdAt"]) - start_day).days // 7 + 1, []).append(float(d["weight"]))
        elif path.startswith("mortality_records/"):
            wk = py.mortality_week(d, start_day)
            deaths_by_week[wk] = deaths_by_week.get(wk, 0) + d["deathCount"]
            total_deaths += d["deathCount"]
    stats = py.weekly_weight_stats(by_week)
    usable = py.usable_weeks(stats, py.flag_weights(stats, gi["stockingWeight"]))
    real = (stats[max(usable)]["median"], max(usable)) if usable else (None, None)

    # Same per-reading filter as fetch_day_readings; a plain mean over kept values equals the count-weighted day average.
    kept, n_readings = {f: [] for f in py.STAT_MAP}, 0
    for _, d in readings:
        got = False
        for feat, key in py.STAT_MAP.items():
            v = py.stat_value(d, key)
            if v is not None and not py.drop_reason(feat, float(v), py.ph_date(d["measuredAt"])):
                kept[feat].append(float(v))
                got = True
        n_readings += got
    water = {f: float(np.mean(v)) for f, v in kept.items()}
    provenance = {"source": "synthetic", "from": readings[0][1]["date"], "to": readings[-1][1]["date"]}
    eligible = (datetime.now(timezone.utc) - start).days >= py.GATE_DAYS
    return gi, water, n_readings, provenance, real, deaths_by_week, total_deaths, py.ph_date(now), not eligible, stats


def run_offline(model, features, ranges):
    gi, water, n_readings, provenance, real, deaths_by_week, total_deaths, today, early, stats = offline_inputs()
    print(f"\n[OFFLINE] seed_demo inputs: cycleStart {gi['cycleStart']:%Y-%m-%d} PHT, early={early}, "
          f"{n_readings} readings ({provenance['from']} to {provenance['to']}), deaths {total_deaths} {dict(sorted(deaths_by_week.items()))}")
    print("[OFFLINE] week medians: " + ", ".join(f"w{w} {s['median']:.3f} (n={s['n']})" for w, s in sorted(stats.items())))
    print("[OFFLINE] cycle-average water: " + ", ".join(f"{k} {v:.3f}" for k, v in water.items()))
    print(f"[OFFLINE] latest usable week {real[1]}: median {real[0]:.3f} g -> projection starts week {real[1] + 1}")
    fields = compute(model, features, ranges, gi, water, n_readings, provenance, real, deaths_by_week, total_deaths, today, early)
    print("\n[OFFLINE] week-by-week projected weight (end of week; anchor = measured):")
    for p in fields["rfProjectionByWeek"]:
        print(f"  week {p['week']:>2}: {p['weightG']:.2f} g")
    print("\n[OFFLINE] fields it WOULD write to growth_indicators/demo-cycle (nothing written):")
    for k, v in fields.items():
        shown = "SERVER_TIMESTAMP" if v is firestore.SERVER_TIMESTAMP else v
        if k == "rfProjectionByWeek":
            shown = f"[{len(v)} points] " + ", ".join(f"{p['week']}:{p['weightG']}" for p in v)
        print(f"  {k}: {shown}")


def run_online(model, features, ranges):
    """predict_yield.main's flow on the demo project with v1 projection; same reads, gates and writes."""
    db = py.connect_firestore(DEMO_ONLY)  # re-checks key, project and client
    gi_doc = py.fetch_growth_indicators(db)
    if gi_doc is None:
        print("[ERROR] Walang growth_indicators doc — hindi makakasulat")
        return
    gi = gi_doc.to_dict()
    cycle_start = gi.get("cycleStart")
    days_since_start = (datetime.now(timezone.utc) - cycle_start).days if cycle_start is not None else None
    early = not (days_since_start is not None and days_since_start >= py.GATE_DAYS)
    if early:
        days_remaining = (py.GATE_DAYS - days_since_start) if days_since_start is not None else None
        gi_doc.reference.update({"rfPending": True, "rfDaysUntilAvailable": days_remaining})
        print(f"[GATE] Hindi pa eligible ({days_since_start} araw); na-mark rfPending.")
        if cycle_start is None:
            return
    if not isinstance(gi.get("initialStock"), (int, float)) or gi["initialStock"] <= 0:
        print("[SKIP] initialStock missing or <= 0 — no yield write.")
        return
    if not isinstance(gi.get("stockingWeight"), (int, float)) or gi["stockingWeight"] <= 0:
        print("[SKIP] stockingWeight missing — no projection.")
        return

    real_weight, real_week, _, n_usable, ulang_reads = py.fetch_latest_real_weight(db, cycle_start, gi["stockingWeight"])
    if early and n_usable < py.EARLY_MIN_USABLE_WEEKS:
        py.save_read_counter(py.load_read_counter() + ulang_reads + 1)
        print(f"[EARLY] {n_usable} usable weight week(s) lang — walang projection.")
        return
    total_deaths, deaths_by_week, mortality_reads = (0, {}, 0) if early else py.fetch_total_deaths(db, cycle_start)

    cache = py.reconcile_daily_cache(py.load_daily_cache(), cycle_start)
    today = py.ph_date(datetime.now(timezone.utc))
    grace_cutoff = today - timedelta(days=py.GRACE_DAYS)
    missing = py.get_missing_dates(cache, py.ph_date(cycle_start), today)
    reads_today = py.load_read_counter()
    reads_used, _ = py.backfill_missing_days(db, cache, missing, max(0, py.SAFETY_THRESHOLD - reads_today), grace_cutoff)
    py.save_read_counter(reads_today + reads_used + mortality_reads + ulang_reads + 1)
    remaining = py.get_missing_dates(cache, py.ph_date(cycle_start), grace_cutoff)
    if remaining:
        gi_doc.reference.update({"rfPending": True, "rfBackfillDaysRemaining": len(remaining),
                                 "rfNote": f"Building sensor history — {len(remaining)} day(s) left; re-run to continue."})
        print(f"[BACKFILL] Incomplete — {len(remaining)} day(s) remaining. Re-run to continue.")
        return
    if not py.check_read_guardrail(py.ESTIMATED_READS_PER_DAY + 1):
        return
    water, n_readings, actual_reads, provenance = py.fetch_today_and_average(db, cache, today)
    py.save_read_counter(py.load_read_counter() + actual_reads)

    fields = compute(model, features, ranges, gi, water, n_readings, provenance, (real_weight, real_week),
                     deaths_by_week, total_deaths, today, early)
    if fields is None:
        print("[EARLY] Walang kumpletong water data — walang early projection.")
        return
    gi_doc.reference.update(fields)
    print(f"[OK] Nasulat sa growth_indicators ({DEMO_ONLY}): rfModelVersion v1, "
          f"projected {fields['rfProjectionByWeek'][-1]['weightG']} g at week {fields['rfProjectionByWeek'][-1]['week']}")


def main():
    parser = argparse.ArgumentParser(description="RF v1 yield prediction for the DEMO project only.")
    parser.add_argument("--project", required=True, choices=[DEMO_ONLY], help="must be bantay-ulang-demo")
    parser.add_argument("--offline", action="store_true", help="no Firestore: seed_demo.py inputs, print the fields")
    args = parser.parse_args()
    if args.project != DEMO_ONLY:  # second guard, independent of argparse
        raise SystemExit(f"[STOP] predict_yield_v1.py only runs on {DEMO_ONLY}.")

    use_v1_state()
    print("=" * 55)
    print(f"BANTAY ULANG — RF v1 YIELD PREDICTION — {DEMO_ONLY}" + (" (OFFLINE)" if args.offline else ""))
    print("=" * 55)
    model, features, ranges = load_v1()
    (run_offline if args.offline else run_online)(model, features, ranges)


if __name__ == "__main__":
    main()
