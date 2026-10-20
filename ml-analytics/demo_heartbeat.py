"""
Bantay Ulang — Demo heartbeat (bantay-ulang-demo ONLY)
======================================================
Keeps the demo dashboard "Online" during a presentation by rewriting ONLY the doc
Aquaponics/Ulang every 60 s with measuredAt = now. Nothing else is written.

  python demo_heartbeat.py --project bantay-ulang-demo          # dry run: print one payload, no connection
  python demo_heartbeat.py --project bantay-ulang-demo --write  # write every 60 s until Ctrl+C

Values replay the last 24 h of week 15 (cycle 1 of bantay_ulang_810_dataset.csv), built by
seed_demo.water_readings, for the current hour of day, plus small noise, clipped inside
seed_demo.THRESHOLDS. Hard guard: --project accepts only bantay-ulang-demo, and the key
(serviceAccountKey.demo.json), project and client are re-checked by connect_firestore.
"""

import argparse
import contextlib
import io
import time
from datetime import datetime, timedelta

import numpy as np

import predict_yield as py
import seed_demo as sd

DEMO_ONLY = py.DEMO_PROJECT
KEY_FILE = "serviceAccountKey.demo.json"
DOC_PATH = "Aquaponics/Ulang"
WEEK = 15
INTERVAL_S = 60
NOISE_SCALE = 0.25  # fraction of seed_demo's per-field noise sd
# Inclusive bounds per field, a small margin inside seed_demo.THRESHOLDS (no threshold -> physical floor only).
T = sd.THRESHOLDS
BOUNDS = {
    "waterTemperatureC": (T["temp_min"] + 0.5, T["temp_max"] - 0.5),
    "phValue": (T["ph_min"] + 0.1, T["ph_max"] - 0.1),
    "oxygenLevelMgL": (T["o2_min"] + 0.2, None),
    "tdsPpm": (1.0, None),
    "turbidityNTU": (0.0, T["turbidity_max"] - 0.5),
    "salinityPpt": (0.0, T["salinity_max"] - 0.5),
}


def replay_by_hour():
    """{hour: reading} for the last 24 h of week WEEK, built exactly as seed_demo builds readings."""
    with contextlib.redirect_stdout(io.StringIO()):
        rows = sd.load_cycle()
    today = datetime.now(py.PHT).date()
    start = datetime.combine(today - timedelta(days=7 * WEEK), datetime.min.time(), py.PHT)
    end = start + timedelta(weeks=WEEK) - timedelta(hours=1)
    docs, _ = sd.water_readings(rows, start, end, np.random.default_rng(42))
    return {d["measuredAt"].hour: d for _, d in docs[-24:]}


def payload(base, now, rng):
    """Same fields and types seed_demo writes to Aquaponics/Ulang, with measuredAt = now."""
    data = {}
    for field, (lo, hi) in BOUNDS.items():
        kind, noise_sd = (sd.WATER[field][1], sd.WATER[field][3]) if field in sd.WATER else ("add", 0.02)
        noise = rng.normal(0, noise_sd * NOISE_SCALE)
        v = base[field] + noise if kind == "add" else base[field] * np.exp(noise)
        data[field] = round(float(np.clip(v, lo, hi if hi is not None else np.inf)), 4)
    data.update(waterLevel=True, measuredAt=now, date=now.strftime("%Y-%m-%d"), time=now.strftime("%H:%M:%S"))
    return data


def line(data):
    return (f"{data['date']} {data['time']} PHT  temp {data['waterTemperatureC']}  pH {data['phValue']}  "
            f"DO {data['oxygenLevelMgL']}  TDS {data['tdsPpm']}  turb {data['turbidityNTU']}  "
            f"sal {data['salinityPpt']}  level {data['waterLevel']}")


def main():
    parser = argparse.ArgumentParser(description="Demo heartbeat: keep Aquaponics/Ulang fresh on the DEMO project only.")
    parser.add_argument("--project", required=True, choices=[DEMO_ONLY], help="must be bantay-ulang-demo")
    parser.add_argument("--write", action="store_true", help=f"write every {INTERVAL_S} s until Ctrl+C (default: dry run)")
    args = parser.parse_args()
    if args.project != DEMO_ONLY:  # second guard, independent of argparse
        raise SystemExit(f"[STOP] demo_heartbeat.py only runs on {DEMO_ONLY}.")
    if py.SERVICE_KEYS[DEMO_ONLY] != KEY_FILE:  # key is fixed; refuse if predict_yield's mapping ever changes
        raise SystemExit(f"[STOP] Expected key {KEY_FILE}, predict_yield maps {py.SERVICE_KEYS[DEMO_ONLY]}.")

    replay = replay_by_hour()
    rng = np.random.default_rng()

    if not args.write:
        now = datetime.now(py.PHT)
        data = payload(replay[now.hour], now, rng)
        print(f"[DRY RUN] Would write {DOC_PATH} in {DEMO_ONLY} (merge):")
        for k, v in data.items():
            print(f"  {k}: {v!r}")
        print("[DRY RUN] Nothing written. Add --write to loop.")
        return

    db = py.connect_firestore(DEMO_ONLY)  # re-checks key, project and client before any write
    ref = db.document(DOC_PATH)
    print(f"[RUN] Writing {DOC_PATH} every {INTERVAL_S} s. Ctrl+C to stop.")
    try:
        while True:
            now = datetime.now(py.PHT)
            data = payload(replay[now.hour], now, rng)
            try:
                ref.set(data, merge=True)
                print(f"[WRITE] {line(data)}")
            except Exception as err:  # keep beating through a transient network error
                print(f"[ERROR] {now:%H:%M:%S} write failed: {err}")
            time.sleep(INTERVAL_S)
    except KeyboardInterrupt:
        print("\n[STOP] Ctrl+C, heartbeat stopped.")


if __name__ == "__main__":
    main()
