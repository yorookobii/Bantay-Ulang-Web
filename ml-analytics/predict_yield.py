"""
Bantay Ulang — RF Yield Prediction (Batch Inference)
=====================================================
Kumukuha ng water parameters mula Firestore (HistoryLogs/Ulang/Readings),
ini-aggregate sa weekly averages, pinapakain sa trained Random Forest,
nag-pro-project ng harvest weight, at isinusulat ang yield prediction
pabalik sa Firestore (growth_indicators).

HYBRID MODE:
  - Water parameters: TOTOO mula Firestore (temp, pH, DO, tds, turbidity)
  - currentWeight + feedRate: ASSUMED (walang stock/feed data pa)

Palitan ang HYBRID_MODE = False kapag may totoong biomass/feed na.
"""

import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd
import numpy as np
import joblib
from datetime import datetime, timedelta, timezone

# ============================================================
# CONFIG
# ============================================================
SERVICE_KEY = "serviceAccountKey.json"
MODEL_FILE = "rf_growth_model.joblib"

HYBRID_MODE = True          # True: assumed weight/feed; False: totoong data
ASSUMED_START_WEIGHT = 2.0  # juvenile start (g) — project buong 18 weeks
HARVEST_WEEK = 18
AGGREGATION_DAYS = 7        # nakaraang 7 araw na water data

# RF features (8, dapat tugma sa training — walang salinity, walang waterLevel)
FEATURES = [
    "weekNumber", "currentWeight",
    "avgWaterTemp", "avgPh", "avgDissolvedOxygen",
    "avgTds", "avgTurbidity", "avgFeedRate",
]

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
# 2. KUNIN + I-AGGREGATE ANG WATER DATA
# ============================================================
def fetch_water_averages(db):
    """
    Kunin ang readings gamit ang collection group query, BATCHED
    (para hindi mag-timeout sa 20k records).
    """
    stat_map = {
        "avgWaterTemp": "waterTemperatureC",
        "avgPh": "phValue",
        "avgDissolvedOxygen": "oxygenLevelMgL",
        "avgTds": "tdsPpm",
        "avgTurbidity": "turbidityNTU",
    }
    collected = {k: [] for k in stat_map}

    BATCH = 500          # kunin 500 kada batch (iwas timeout)
    MAX_READINGS = 5000  # limitahan sa 5000 para mabilis (sapat na sa average)

    readings_query = db.collection_group("readings").limit(BATCH)

    used = 0
    skipped = 0
    last_doc = None
    total_fetched = 0

    while total_fetched < MAX_READINGS:
        q = readings_query
        if last_doc is not None:
            q = db.collection_group("readings").limit(BATCH).start_after(last_doc)

        batch_docs = list(q.stream())
        if not batch_docs:
            break  # wala nang natitira

        for doc in batch_docs:
            data = doc.to_dict()
            stats = data.get("statistics", {})
            if not stats:
                skipped += 1
                continue
            got = False
            for feat, stat_key in stat_map.items():
                param = stats.get(stat_key, {})
                avg = param.get("average")
                if avg is not None:
                    collected[feat].append(float(avg))
                    got = True
            if got:
                used += 1
            else:
                skipped += 1

        last_doc = batch_docs[-1]
        total_fetched += len(batch_docs)
        print(f"[INFO] Nakuha: {total_fetched} readings...")

        if len(batch_docs) < BATCH:
            break  # huling batch na

    print(f"[INFO] Kabuuan: {total_fetched} readings scanned")

    if used == 0:
        print("[WARN] Walang usable readings — test-mode fallback")
        return None, 0

    water = {}
    for feat, vals in collected.items():
        if vals:
            water[feat] = float(np.mean(vals))
        else:
            print(f"[WARN] Walang data para sa {feat}")
            water[feat] = None

    print(f"[OK] Na-aggregate: {used} readings (skipped: {skipped})")
    return water, used

# ============================================================
# 3. ASSUMED VALUES (HYBRID MODE)
# ============================================================
def optimal_feed_rate(weight):
    """Gupta et al.: 10% (maliit) -> 5% (malaki). Linear interpolation."""
    if weight <= 2:
        return 10.0
    if weight >= 25:
        return 5.0
    return 10.0 - (weight - 2) * (5.0 / 23.0)

def get_optimal_fallback():
    """Assumed optimal conditions kung walang totoong water data."""
    return {
        "avgWaterTemp": 29.0, "avgPh": 7.6, "avgDissolvedOxygen": 6.5,
        "avgTds": 250.0, "avgTurbidity": 12.0,
    }

# ============================================================
# 4. PROJECT HARVEST WEIGHT (via RF)
# ============================================================
def project_harvest_weight(model, water, start_weight):
    """I-project ang weight mula start_weight hanggang harvest (week 18)."""
    weight = start_weight
    for wk in range(1, HARVEST_WEEK + 1):
        feed_rate = optimal_feed_rate(weight)  # assumed (hybrid)
        feat = pd.DataFrame([{
            "weekNumber": wk,
            "currentWeight": weight,
            "avgWaterTemp": water["avgWaterTemp"],
            "avgPh": water["avgPh"],
            "avgDissolvedOxygen": water["avgDissolvedOxygen"],
            "avgTds": water["avgTds"],
            "avgTurbidity": water["avgTurbidity"],
            "avgFeedRate": feed_rate,
        }])[FEATURES]
        growth = float(model.predict(feat)[0])
        weight += growth
    return weight

# ============================================================
# 5. COMPUTE YIELD
# ============================================================
def compute_yield(db, harvest_weight):
    """Yield = stock x survival x harvest_weight / 1000 (mula growth_indicators)."""
    docs = list(db.collection("growth_indicators").limit(1).stream())
    if not docs:
        print("[WARN] Walang growth_indicators — gagamit ng default (50 stock, 80%)")
        return None, 50, 80.0

    doc = docs[0]
    gi = doc.to_dict()
    stock = gi.get("initialStock", 50)
    survival = gi.get("survivalRate", 80.0)

    yield_kg = stock * (survival / 100.0) * harvest_weight / 1000.0
    return doc.reference, stock, survival, yield_kg

# ============================================================
# 6. ISULAT PABALIK SA FIRESTORE
# ============================================================
def write_prediction(doc_ref, harvest_weight, yield_kg, mode, n_readings):
    notes = {
        "test": "Test-mode: assumed optimal conditions (walang readings pa)",
        "hybrid": "Hybrid: real water params, assumed biomass/feed",
        "real": "Full real-data prediction",
    }
    payload = {
        "rfProjectedWeight": round(harvest_weight, 2),
        "rfProjectedYield": round(yield_kg, 3),
        "rfMode": mode,
        "rfReadingsUsed": n_readings,
        "rfUpdatedAt": firestore.SERVER_TIMESTAMP,
        "rfNote": notes.get(mode, "Unknown mode"),
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
    model = joblib.load(MODEL_FILE)
    print(f"[OK] Na-load ang model: {MODEL_FILE}")

    # Kunin ang water data
    water, n_readings = fetch_water_averages(db)

    # Determine mode
    if water is None or any(v is None for v in water.values()):
        print("[MODE] Walang kumpletong water data -> TEST-MODE (assumed optimal)")
        water = get_optimal_fallback()
        mode = "test"
        n_readings = 0
    else:
        mode = "hybrid" if HYBRID_MODE else "real"
        print(f"[MODE] {mode.upper()} — totoong water params")
        print(f"       Water: temp={water['avgWaterTemp']:.1f} pH={water['avgPh']:.2f} "
              f"DO={water['avgDissolvedOxygen']:.1f} tds={water['avgTds']:.0f} "
              f"turb={water['avgTurbidity']:.1f}")

    # Project harvest weight
    harvest_weight = project_harvest_weight(model, water, ASSUMED_START_WEIGHT)
    print(f"[OK] Projected harvest weight: {harvest_weight:.1f}g "
          f"(mula {ASSUMED_START_WEIGHT}g, {HARVEST_WEEK} weeks)")

    # Compute yield
    result = compute_yield(db, harvest_weight)
    if result[0] is None:
        print("[ERROR] Walang growth_indicators doc — hindi makakasulat")
        return
    doc_ref, stock, survival, yield_kg = result
    print(f"[OK] YIELD = {stock} x {survival}% x {harvest_weight:.1f}g / 1000 = {yield_kg:.2f} kg")

    # Isulat pabalik
    write_prediction(doc_ref, harvest_weight, yield_kg, mode, n_readings)

    print("=" * 55)
    print("TAPOS — prediction nasa Firestore growth_indicators")
    print("=" * 55)

if __name__ == "__main__":
    main()
