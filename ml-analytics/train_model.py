"""
Bantay Ulang — RF v2 Training
==============================
Tine-train ang RandomForestRegressor sa synthetic_v2.csv (generate_synthetic.py).
Validation: GroupKFold by cycleId (hindi row-random, para walang leak sa loob ng cycle).
Kung may real_training_rows.csv, hiwalay itong ine-evaluate at hindi kasama sa training
o sa synthetic score.

Output: rf_growth_model_v2.joblib + model_meta.json (basa ng predict_yield.py).
Hindi ginagalaw ang rf_growth_model.joblib (v1).
"""

import json
import os
import platform
from datetime import datetime
import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold

# avgTds stays in synthetic_v2.csv for reference but isn't a feature: the real readings barely vary it.
FEATURES = ["currentWeight", "avgWaterTemp", "avgPh", "avgTurbidity"]
TARGET = "weeklyGrowthIncrement"
SYNTHETIC_FILE = "synthetic_v2.csv"
SYNTHETIC_META_FILE = "synthetic_v2.json"
REAL_FILE = "real_training_rows.csv"
MODEL_FILE = "rf_growth_model_v2.joblib"
META_FILE = "model_meta.json"
RF_PARAMS = {"n_estimators": 300, "min_samples_leaf": 5, "random_state": 42, "n_jobs": -1}
N_SPLITS = 5

def cross_validate(df):
    """MAE and R2 per GroupKFold fold, grouped by cycleId."""
    folds = []
    for i, (tr, te) in enumerate(GroupKFold(n_splits=N_SPLITS).split(df[FEATURES], df[TARGET], df["cycleId"]), 1):
        model = RandomForestRegressor(**RF_PARAMS).fit(df.iloc[tr][FEATURES], df.iloc[tr][TARGET])
        pred = model.predict(df.iloc[te][FEATURES])
        folds.append({"fold": i, "testRows": len(te), "testCycles": int(df.iloc[te]["cycleId"].nunique()),
                      "mae": float(mean_absolute_error(df.iloc[te][TARGET], pred)),
                      "r2": float(r2_score(df.iloc[te][TARGET], pred))})
        print(f"[CV] Fold {i}: MAE {folds[-1]['mae']:.3f} g, R2 {folds[-1]['r2']:.3f} ({len(te)} rows)")
    summary = {k: float(np.mean([f[k] for f in folds])) for k in ("mae", "r2")}
    summary.update({k + "Sd": float(np.std([f[k] for f in folds], ddof=1)) for k in ("mae", "r2")})
    print(f"[CV] Mean: MAE {summary['mae']:.3f} +- {summary['maeSd']:.3f} g, R2 {summary['r2']:.3f} +- {summary['r2Sd']:.3f}")
    return {"method": f"GroupKFold(n_splits={N_SPLITS}) by cycleId", "folds": folds, **summary}

def evaluate_real(model):
    """Separate score on real_training_rows.csv, or None when the file or usable rows are missing."""
    if not os.path.exists(REAL_FILE):
        print(f"[REAL] {REAL_FILE} wala pa — walang real evaluation.")
        return None
    real = pd.read_csv(REAL_FILE).dropna(subset=FEATURES + [TARGET])
    if real.empty:
        print(f"[REAL] {REAL_FILE} walang usable row.")
        return None
    pred = model.predict(real[FEATURES])
    result = {"file": REAL_FILE, "rows": len(real), "mae": float(mean_absolute_error(real[TARGET], pred)),
              "r2": float(r2_score(real[TARGET], pred)) if len(real) >= 2 else None}
    print(f"[REAL] {len(real)} rows: MAE {result['mae']:.3f} g"
          + (f", R2 {result['r2']:.3f}" if result["r2"] is not None else "")
          + (" (too few rows for a meaningful R2)" if len(real) < 20 else ""))
    return result

def main():
    df = pd.read_csv(SYNTHETIC_FILE, dtype={"cycleId": str})
    print(f"[OK] {SYNTHETIC_FILE}: {len(df)} rows, {df['cycleId'].nunique()} cycles")

    cv = cross_validate(df)
    model = RandomForestRegressor(**RF_PARAMS).fit(df[FEATURES], df[TARGET])
    importances = {f: float(v) for f, v in sorted(zip(FEATURES, model.feature_importances_), key=lambda p: -p[1])}
    print("[OK] Feature importances: " + ", ".join(f"{f} {v:.3f}" for f, v in importances.items()))
    real = evaluate_real(model)

    with open(SYNTHETIC_META_FILE, encoding="utf-8") as f:
        synthetic_meta = json.load(f)
    ranges = {f: [float(df[f].min()), float(df[f].max())] for f in FEATURES}
    meta = {
        "modelFile": MODEL_FILE,
        "features": FEATURES,
        "target": TARGET,
        "modelParams": RF_PARAMS,
        "versions": {"python": platform.python_version(), "sklearn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__},
        "trainingRows": len(df),
        "trainingCycles": int(df["cycleId"].nunique()),
        "weightRange": ranges["currentWeight"],
        "featureRanges": ranges,
        "featureImportances": importances,
        "cv": cv,
        "realEvaluation": real,
        "dataSources": {"synthetic": SYNTHETIC_FILE, **synthetic_meta},
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    joblib.dump(model, MODEL_FILE)
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"[OK] Saved {MODEL_FILE} + {META_FILE}")

if __name__ == "__main__":
    main()
