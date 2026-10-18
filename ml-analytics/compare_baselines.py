"""
RF v2 vs baseline regressors on synthetic_v2.csv, offline (no Firestore, no model files written).

Same features, target and GroupKFold-by-cycleId folds as train_model.py; every model sees the same folds.
Output: comparison/baselines.csv (utf-8-sig) and a printed table.
"""
import json
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

from train_model import FEATURES, N_SPLITS, RF_PARAMS, SYNTHETIC_FILE, TARGET

SEED = 42
META_FILE = "model_meta.json"  # read only, to check the RF row against the recorded RF v2 CV
OUT_FILE = os.path.join("comparison", "baselines.csv")
TOLERANCE = 0.0005  # recorded values are quoted to 3 decimals

MODELS = {
    "Mean baseline": lambda: DummyRegressor(strategy="mean"),
    "Multiple Linear Regression": LinearRegression,
    "Random Forest (RF v2)": lambda: RandomForestRegressor(**RF_PARAMS),
    "HistGradientBoosting": lambda: HistGradientBoostingRegressor(random_state=SEED),
}


def main():
    df = pd.read_csv(SYNTHETIC_FILE, dtype={"cycleId": str})
    X, y = df[FEATURES], df[TARGET]
    folds = list(GroupKFold(n_splits=N_SPLITS).split(X, y, df["cycleId"]))
    print(f"[OK] {SYNTHETIC_FILE}: {len(df)} rows, {df['cycleId'].nunique()} cycles, {N_SPLITS} folds by cycleId")

    rows = []
    for name, make in MODELS.items():
        mae, r2 = [], []
        for tr, te in folds:
            pred = make().fit(X.iloc[tr], y.iloc[tr]).predict(X.iloc[te])
            mae.append(mean_absolute_error(y.iloc[te], pred))
            r2.append(r2_score(y.iloc[te], pred))
        rows.append({"model": name, "mae_mean": np.mean(mae), "mae_sd": np.std(mae, ddof=1),
                     "r2_mean": np.mean(r2), "r2_sd": np.std(r2, ddof=1),
                     **{f"mae_fold{i}": v for i, v in enumerate(mae, 1)},
                     **{f"r2_fold{i}": v for i, v in enumerate(r2, 1)}})
    table = pd.DataFrame(rows)

    print(f"\n{'Model':<28} {'MAE (g/week)':>16} {'R²':>16}")
    for _, r in table.iterrows():
        print(f"{r.model:<28} {r.mae_mean:>8.3f} ± {r.mae_sd:.3f} {r.r2_mean:>8.3f} ± {r.r2_sd:.3f}")

    with open(META_FILE, encoding="utf-8") as f:
        cv = json.load(f)["cv"]
    rf = table.set_index("model").loc["Random Forest (RF v2)"]
    got = {"mae": rf.mae_mean, "maeSd": rf.mae_sd, "r2": rf.r2_mean, "r2Sd": rf.r2_sd}
    off = {k: (v, cv[k]) for k, v in got.items() if abs(v - cv[k]) > TOLERANCE}
    if off:
        raise SystemExit("[STOP] RF row does not reproduce model_meta.json: "
                         + ", ".join(f"{k} {v:.4f} vs {m:.4f}" for k, (v, m) in off.items()))
    print(f"\n[OK] RF row reproduces model_meta.json: MAE {cv['mae']:.3f} ± {cv['maeSd']:.3f}, R² {cv['r2']:.3f} ± {cv['r2Sd']:.3f}")

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    table.round(4).to_csv(OUT_FILE, index=False, encoding="utf-8-sig")
    print(f"[OK] Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
