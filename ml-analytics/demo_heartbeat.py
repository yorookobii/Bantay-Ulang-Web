"""
Bantay Ulang — Demo heartbeat (bantay-ulang-demo ONLY)
======================================================
Keeps the demo dashboard "Online" during a presentation by rewriting the doc
Aquaponics/Ulang every 60 s with measuredAt = now, and appends the same values as one
HistoryLogs reading per 5-min slot (seed_demo format, id reading_hb_HHMM) so the trend
charts, history and reports stay current. Nothing else is written.

  python demo_heartbeat.py --project bantay-ulang-demo          # dry run: print one payload, no connection
  python demo_heartbeat.py --project bantay-ulang-demo --write  # write every 60 s until Ctrl+C
  python demo_heartbeat.py --project bantay-ulang-demo --cycle-file poor_cycle.csv  # replay that CSV's week 15

Values replay the last 24 h of week 15 (cycle 1 of bantay_ulang_810_dataset.csv, or the
--cycle-file cycle), built by seed_demo.water_readings, for the current hour of day, plus small
noise, clipped inside seed_demo.THRESHOLDS (physical floors only with --cycle-file). Hard guard: --project accepts only bantay-ulang-demo, and the key
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
HISTORY_EVERY_MIN = 5
# Per-reading fields seed_demo.water_readings adds on top of the Aquaponics/Ulang fields.
HISTORY_EXTRA = {"expectedSamples": 20, "samplesCollected": 20, "summaryWindowSeconds": 3600}
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
# With --cycle-file: physical floors only, so out-of-range water stays out of range.
PHYSICAL_BOUNDS = {"waterTemperatureC": (0.0, None), "phValue": (0.0, 14.0), "oxygenLevelMgL": (0.0, None),
                   "tdsPpm": (1.0, None), "turbidityNTU": (0.0, None), "salinityPpt": (0.0, None)}


def replay_by_hour(cycle_file=None):
    """{hour: reading} for the last 24 h of week WEEK, built exactly as seed_demo builds readings."""
    with contextlib.redirect_stdout(io.StringIO()):
        rows = sd.load_cycle(cycle_file)
    today = datetime.now(py.PHT).date()
    start = datetime.combine(today - timedelta(days=7 * WEEK), datetime.min.time(), py.PHT)
    end = start + timedelta(weeks=WEEK) - timedelta(hours=1)
    docs, _ = sd.water_readings(rows, start, end, np.random.default_rng(42))
    return {d["measuredAt"].hour: d for _, d in docs[-24:]}


def payload(base, now, rng, bounds=BOUNDS):
    """Same fields and types seed_demo writes to Aquaponics/Ulang, with measuredAt = now."""
    data = {}
    for field, (lo, hi) in bounds.items():
        kind, noise_sd = (sd.WATER[field][1], sd.WATER[field][3]) if field in sd.WATER else ("add", 0.02)
        noise = rng.normal(0, noise_sd * NOISE_SCALE)
        v = base[field] + noise if kind == "add" else base[field] * np.exp(noise)
        data[field] = round(float(np.clip(v, lo, hi if hi is not None else np.inf)), 4)
    data.update(waterLevel=True, measuredAt=now, date=now.strftime("%Y-%m-%d"), time=now.strftime("%H:%M:%S"))
    return data


def history_path(now):
    """Seed-style reading path; one id per 5-min slot, so a restart rewrites the same doc."""
    s = now.replace(minute=now.minute - now.minute % HISTORY_EVERY_MIN, second=0, microsecond=0)
    return f"HistoryLogs/Ulang/years/reading_{s:%Y}/reading_{s:%m}/reading_{s:%d}/readings/reading_hb_{s:%H%M}"


def line(data):
    return (f"{data['date']} {data['time']} PHT  temp {data['waterTemperatureC']}  pH {data['phValue']}  "
            f"DO {data['oxygenLevelMgL']}  TDS {data['tdsPpm']}  turb {data['turbidityNTU']}  "
            f"sal {data['salinityPpt']}  level {data['waterLevel']}")


def main():
    parser = argparse.ArgumentParser(description="Demo heartbeat: keep Aquaponics/Ulang fresh on the DEMO project only.")
    parser.add_argument("--project", required=True, choices=[DEMO_ONLY], help="must be bantay-ulang-demo")
    parser.add_argument("--write", action="store_true", help=f"write every {INTERVAL_S} s until Ctrl+C (default: dry run)")
    parser.add_argument("--cycle-file", help="replay week 15 of this one-cycle CSV (seed_demo.py format), unclipped")
    args = parser.parse_args()
    if args.project != DEMO_ONLY:  # second guard, independent of argparse
        raise SystemExit(f"[STOP] demo_heartbeat.py only runs on {DEMO_ONLY}.")
    if py.SERVICE_KEYS[DEMO_ONLY] != KEY_FILE:  # key is fixed; refuse if predict_yield's mapping ever changes
        raise SystemExit(f"[STOP] Expected key {KEY_FILE}, predict_yield maps {py.SERVICE_KEYS[DEMO_ONLY]}.")

    replay = replay_by_hour(args.cycle_file)
    bounds = PHYSICAL_BOUNDS if args.cycle_file else BOUNDS
    rng = np.random.default_rng()

    if not args.write:
        now = datetime.now(py.PHT)
        data = payload(replay[now.hour], now, rng, bounds)
        print(f"[DRY RUN] Would write {DOC_PATH} in {DEMO_ONLY} (merge)"
              + (f", replaying {args.cycle_file} week {WEEK}, physical bounds only:" if args.cycle_file else ":"))
        for k, v in data.items():
            print(f"  {k}: {v!r}")
        print(f"[DRY RUN] Would also write {history_path(now)} (same fields, plus):")
        for k, v in HISTORY_EXTRA.items():
            print(f"  {k}: {v!r}")
        print("[DRY RUN] Nothing written. Add --write to loop.")
        return

    db = py.connect_firestore(DEMO_ONLY)  # re-checks key, project and client before any write
    ref = db.document(DOC_PATH)
    print(f"[RUN] Writing {DOC_PATH} every {INTERVAL_S} s, HistoryLogs every {HISTORY_EVERY_MIN} min. Ctrl+C to stop.")
    last_path = None
    try:
        while True:
            now = datetime.now(py.PHT)
            data = payload(replay[now.hour], now, rng, bounds)
            try:
                ref.set(data, merge=True)
                print(f"[WRITE] {line(data)}")
                path = history_path(now)
                if path != last_path:
                    db.document(path).set({**data, **HISTORY_EXTRA})
                    last_path = path
                    print(f"[HISTORY] {path}")
            except Exception as err:  # keep beating through a transient network error
                print(f"[ERROR] {now:%H:%M:%S} write failed: {err}")
            time.sleep(INTERVAL_S)
    except KeyboardInterrupt:
        print("\n[STOP] Ctrl+C, heartbeat stopped.")


if __name__ == "__main__":
    main()
