"""
Feature ablation for RF v2 on synthetic_v2.csv, offline (no Firestore, no model files written).

Same RF_PARAMS, target and GroupKFold-by-cycleId folds as train_model.py; every feature set sees the same folds.
DO cannot be tested: synthetic_v2.csv has no dissolved-oxygen column.
Output: comparison/feature_ablation.csv (utf-8-sig) and a printed table.
"""
import json
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

from train_model import FEATURES, N_SPLITS, RF_PARAMS, SYNTHETIC_FILE, TARGET

SEED = 42
META_FILE = "model_meta.json"  # read only, to check set A against the recorded RF v2 CV
OUT_FILE = os.path.join("comparison", "feature_ablation.csv")
TOLERANCE = 0.0005  # recorded values are quoted to 3 decimals
EXTRAS = ["weekNumber", "avgFeedRate", "avgTds", "stockingWeight"]  # candidates, kept only if present in the CSV
PERM_REPEATS = 10


def score(df, cols, folds, perm=False):
    """MAE and R2 per fold, plus mean permutation importance (MAE increase) on the test folds when perm is set."""
    X, y = df[cols], df[TARGET]
    mae, r2, imp = [], [], []
    for tr, te in folds:
        model = RandomForestRegressor(**RF_PARAMS).fit(X.iloc[tr], y.iloc[tr])
        pred = model.predict(X.iloc[te])
        mae.append(mean_absolute_error(y.iloc[te], pred))
        r2.append(r2_score(y.iloc[te], pred))
        if perm:
            res = permutation_importance(model, X.iloc[te], y.iloc[te], scoring="neg_mean_absolute_error",
                                         n_repeats=PERM_REPEATS, random_state=SEED, n_jobs=-1)
            imp.append(res.importances_mean)
    return mae, r2, (np.array(imp) if perm else None)


def main():
    df = pd.read_csv(SYNTHETIC_FILE, dtype={"cycleId": str})
    folds = list(GroupKFold(n_splits=N_SPLITS).split(df, df[TARGET], df["cycleId"]))
    print(f"[OK] {SYNTHETIC_FILE}: {len(df)} rows, {df['cycleId'].nunique()} cycles, {N_SPLITS} folds by cycleId")

    extras = [c for c in EXTRAS if c in df.columns]
    for c in sorted(set(EXTRAS) - set(extras)):
        print(f"[SKIP] {c}: column not in {SYNTHETIC_FILE}")
    print("[NOTE] DO not tested: no dissolved-oxygen column in the v2 data")

    sets = {"A: v2 inputs": FEATURES}
    for label, col in [("B", "weekNumber"), ("C", "avgFeedRate"), ("D", "avgTds")]:
        if col in extras:
            sets[f"{label}: + {col}"] = FEATURES + [col]
    sets["E: + all extras"] = FEATURES + extras
    if {"stockingWeight", "weekNumber"} <= set(extras):
        sets["F: + stockingWt + weekNo"] = FEATURES + ["stockingWeight", "weekNumber"]

    rows, perm = [], None
    for name, cols in sets.items():
        mae, r2, imp = score(df, cols, folds, perm=name.startswith("E"))
        if imp is not None:
            perm = pd.DataFrame({"feature": cols, "mae_increase_mean": imp.mean(0), "mae_increase_sd": imp.std(0, ddof=1)})
        rows.append({"feature_set": name, "features": " ".join(cols), "mae_mean": np.mean(mae), "mae_sd": np.std(mae, ddof=1),
                     "r2_mean": np.mean(r2), "r2_sd": np.std(r2, ddof=1),
                     **{f"mae_fold{i}": v for i, v in enumerate(mae, 1)},
                     **{f"r2_fold{i}": v for i, v in enumerate(r2, 1)}})
    table = pd.DataFrame(rows)

    print(f"\n{'Feature set':<26} {'MAE (g/week)':>16} {'R²':>16}")
    for _, r in table.iterrows():
        print(f"{r.feature_set:<26} {r.mae_mean:>8.3f} ± {r.mae_sd:.3f} {r.r2_mean:>8.3f} ± {r.r2_sd:.3f}")

    print(f"\nPermutation importance, set E (MAE increase, mean ± SD over {N_SPLITS} test folds):")
    for _, r in perm.sort_values("mae_increase_mean", ascending=False).iterrows():
        print(f"  {r.feature:<16} {r.mae_increase_mean:>7.3f} ± {r.mae_increase_sd:.3f}")

    with open(META_FILE, encoding="utf-8") as f:
        cv = json.load(f)["cv"]
    a = table.iloc[0]
    got = {"mae": a.mae_mean, "maeSd": a.mae_sd, "r2": a.r2_mean, "r2Sd": a.r2_sd}
    off = {k: (v, cv[k]) for k, v in got.items() if abs(v - cv[k]) > TOLERANCE}
    if off:
        raise SystemExit("[STOP] Set A does not reproduce model_meta.json: "
                         + ", ".join(f"{k} {v:.4f} vs {m:.4f}" for k, (v, m) in off.items()))
    print(f"\n[OK] Set A reproduces model_meta.json: MAE {cv['mae']:.3f} ± {cv['maeSd']:.3f}, R² {cv['r2']:.3f} ± {cv['r2Sd']:.3f}")

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    perm_row = {f"perm_E_{r.feature}": r.mae_increase_mean for _, r in perm.iterrows()}
    table.loc[table.feature_set.str.startswith("E"), list(perm_row)] = list(perm_row.values())
    table.round(4).to_csv(OUT_FILE, index=False, encoding="utf-8-sig")
    print(f"[OK] Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
