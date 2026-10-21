"""
Bantay Ulang — Demo seed (bantay-ulang-demo ONLY)
==================================================
Seeds the demo Firebase project from ONE cycle of bantay_ulang_810_dataset.csv
(cycle 1, the first-run v1 training data), labelled "Demo cycle (training data, cycle 1)".

  python seed_demo.py                       # dry run: plan + write counts, no connection
  python seed_demo.py --write --admin-email A --tech-email T          # write (empty project)
  python seed_demo.py --write --reset --admin-email A --tech-email T  # wipe seeded collections, re-anchor to today
  python seed_demo.py --cycle-file poor_cycle.csv   # any of the above, seeded from that CSV's one cycle instead of cycle 1

Refuses to connect unless serviceAccountKey.demo.json's project_id is bantay-ulang-demo
(connect_firestore in predict_yield.py). Auth users are created in the console first;
their UIDs are looked up by email.

NOT AN ACCURACY TEST: v1 was trained on this dataset (row-level 80/20 split), so v1
output on it is in-sample; the dataset itself is simulated, so v2 output proves nothing either.
"""

import argparse
import math
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from predict_yield import DEMO_PROJECT, PHT, connect_firestore, optimal_feed_rate

DATASET = "bantay_ulang_810_dataset.csv"
CYCLE_ID = 1
CYCLE_LABEL = "Demo cycle (training data, cycle 1)"
INITIAL_STOCK = 30
GROWOUT_DAYS = 150  # same as settings.js GROWOUT_DAYS
DEATHS_BY_WEEK = {1: 2, 2: 1, 4: 1, 7: 1, 10: 1, 13: 1}  # 7 of 30 = 23.3% mortality
DEVICE_ID = "ESP32-001"
FEED_TIMES = ["07:00", "12:00", "17:00"]
# Same keys and defaults as thresholds.js DEFAULT_RANGES / settings.js FIELDS.
THRESHOLDS = {"ph_min": 6.5, "ph_max": 8.5, "temp_min": 22, "temp_max": 32, "o2_min": 5,
              "salinity_max": 5, "turbidity_max": 25, "waterlevel_min": 0.5, "waterlevel_max": 2.0}
# Firmware field -> (dataset column, noise kind, diurnal amplitude, noise sd); diurnal peak at 14:00 PHT.
WATER = {
    "waterTemperatureC": ("avgWaterTemp", "add", 1.0, 0.2),
    "phValue": ("avgPh", "add", 0.05, 0.03),
    "oxygenLevelMgL": ("avgDissolvedOxygen", "add", 0.6, 0.15),
    "tdsPpm": ("avgTds", "mul", 0.0, 0.03),
    "turbidityNTU": ("avgTurbidity", "mul", 0.0, 0.10),
}
# Top-level collections this script owns; --reset deletes them (users docs are overwritten, not deleted).
SEEDED = ["growth_indicators", "ulang_growth_records", "mortality_records", "logs", "tasks", "alerts",
          "feeding_schedules", "settings", "HistoryLogs", "ActionLogs", "Aquaponics"]


def read_cycle_file(path, df):
    """One cycle from a CSV in the dataset's exact format; stops on wrong columns, dtypes, ids or weeks."""
    rows = pd.read_csv(path)
    if list(rows.columns) != list(df.columns) or not rows.dtypes.equals(df.dtypes):
        raise SystemExit(f"[STOP] {path}: columns/dtypes must match {DATASET}: {list(df.columns)}")
    if rows.isna().any().any() or rows.cycleId.nunique() != 1:
        raise SystemExit(f"[STOP] {path}: needs exactly one cycleId and no empty cells.")
    if sorted(rows.weekNumber) != list(range(1, int(df.weekNumber.max()) + 1)):
        raise SystemExit(f"[STOP] {path}: needs weeks 1..{int(df.weekNumber.max())}, one row each.")
    return rows


def cycle_label(rows):
    """growth_indicators cycleLabel; a cycle file gets its own so predict can tell which cycle was seeded."""
    cid = int(rows.cycleId.iloc[0])
    return CYCLE_LABEL if cid == CYCLE_ID else f"Demo cycle (cycle file, cycle {cid})"


def load_cycle(path=None):
    """Cycle rows by week (cycle 1, or the one cycle in path), and how the cycle compares with the dataset medians."""
    df = pd.read_csv(DATASET)
    rows = (read_cycle_file(path, df) if path else df[df.cycleId == CYCLE_ID]).set_index("weekNumber").sort_index()
    cid = int(rows.cycleId.iloc[0])
    last = df.sort_values("weekNumber").groupby("cycleId").tail(1)
    final = (last.currentWeight + last.weeklyGrowthIncrement).set_axis(last.cycleId)
    own_final = rows.currentWeight.iloc[-1] + rows.weeklyGrowthIncrement.iloc[-1]
    means = df.groupby("cycleId")[[c for c, *_ in WATER.values()]].mean()
    print(f"[DATA] Cycle {cid}{f' ({path})' if path else ''}: {len(rows)} weeks. Final weight {own_final:.2f} g vs median "
          f"{final.median():.2f} g ({(final < own_final).mean():.0%} of cycles lower)")
    for col in means:
        print(f"[DATA]   {col}: {rows[col].mean():.2f} vs median {means[col].median():.2f}")
    return rows


def week_of(t, start):
    return (t.date() - start.date()).days // 7 + 1


def water_readings(rows, start, now, rng):
    """Hourly readings from start to now; each week is re-centred so its mean equals that week's row."""
    hours = [start + timedelta(hours=h) for h in range(int((now - start).total_seconds() // 3600) + 1)]
    weeks = np.array([week_of(t, start) for t in hours])
    diurnal = np.sin(2 * math.pi * (np.array([t.hour for t in hours]) - 8) / 24)
    values = {}
    for field, (col, kind, amp, sd) in WATER.items():
        target = rows.loc[weeks, col].to_numpy()
        noise = rng.normal(0, sd, len(hours))
        v = target + amp * diurnal + noise if kind == "add" else target * np.exp(noise)
        for w in np.unique(weeks):
            m = weeks == w
            v[m] = v[m] + (target[m][0] - v[m].mean()) if kind == "add" else v[m] * target[m][0] / v[m].mean()
        values[field] = v
    salinity = np.clip(rng.normal(0.2, 0.02, len(hours)), 0, None)
    docs, per_day = [], {}
    for i, t in enumerate(hours):
        n = per_day[t.date()] = per_day.get(t.date(), 0) + 1
        at = t + timedelta(seconds=89)
        data = {f: round(float(values[f][i]), 4) for f in WATER}
        data.update(salinityPpt=round(float(salinity[i]), 4), waterLevel=True, measuredAt=at,
                    date=at.strftime("%Y-%m-%d"), time=at.strftime("%H:%M:%S"),
                    expectedSamples=20, samplesCollected=20, summaryWindowSeconds=3600)
        docs.append((f"HistoryLogs/Ulang/years/reading_{t:%Y}/reading_{t:%m}/reading_{t:%d}/readings/reading_{n:03d}", data))
    return docs, weeks


def end_weight(rows, w):
    """Weight at the end of week w (currentWeight is the weight entering week w), 3 dp."""
    return round(float(rows.loc[w, "currentWeight"] + rows.loc[w, "weeklyGrowthIncrement"]), 3)


def weight_samples(target, n, rng):
    """n weights whose median is exactly target: symmetric 3-dp pairs, plus target itself when n is odd."""
    deltas = np.round(np.clip(np.abs(rng.normal(0, 0.12, n // 2)), 0.01, 0.35) * target, 3)
    w = [round(float(target + d), 3) for d in deltas] + [round(float(target - d), 3) for d in deltas] + [target] * (n % 2)
    rng.shuffle(w)
    return w


def build(rows, weeks_seeded, now, admin, tech, rng):
    """[(doc path, data)] for every seeded doc."""
    start = datetime.combine(now.date() - timedelta(days=7 * weeks_seeded), datetime.min.time(), PHT)
    readings, reading_weeks = water_readings(rows, start, now, rng)
    common = lambda t, kind: {"createdBy": tech["uid"], "createdByName": tech["name"], "createdByEmail": tech["email"],
                              "type": kind, "createdAt": t, "observedAt": t - timedelta(minutes=1)}
    docs = list(readings)
    for w in range(1, weeks_seeded + 1):
        # Weighed on the week's last day (day 6), so the median is the end-of-week weight predict_yield steps from.
        target = end_weight(rows, w)
        for i, g in enumerate(weight_samples(target, int(rng.integers(10, 13)), rng)):
            t = start + timedelta(days=7 * (w - 1) + 6, hours=9, minutes=2 * i)
            size = round((g / 0.0127) ** (1 / 3), 1)  # illustrative length-weight curve, cm
            doc_id = f"demo-w{w:02d}-s{i:02d}"
            docs.append((f"ulang_growth_records/{doc_id}", {"size": size, "weight": g, "recordedBy": tech["uid"],
                                                            "createdAt": t, "observedAt": t - timedelta(minutes=1)}))
            docs.append((f"logs/{doc_id}", {**common(t, "ulang"), "title": "Ulang Log", "size": str(size), "weight": str(g),
                                            "description": f"Laki: {size}cm • Timbang: {g}g"}))
    for w, n in DEATHS_BY_WEEK.items():
        if w > weeks_seeded:
            continue
        t = start + timedelta(days=7 * (w - 1) + 3, hours=17)
        docs.append((f"mortality_records/demo-mort-w{w:02d}", {"deathCount": n, "weekNumber": w, "recordedBy": tech["uid"], "createdAt": t}))
        docs.append((f"logs/demo-mort-w{w:02d}", {**common(t, "mortality"), "title": "Mortality Log", "deathCount": n,
                                                  "weekNumber": w, "description": f"Namatay: {n} ulang • Linggo: {w}"}))

    deaths = sum(n for w, n in DEATHS_BY_WEEK.items() if w <= weeks_seeded)
    survival = (INITIAL_STOCK - deaths) / INITIAL_STOCK * 100
    latest_g = round(end_weight(rows, weeks_seeded), 2)
    stocking_g = round(float(rows.loc[1, "currentWeight"]), 3)
    docs.append(("growth_indicators/demo-cycle", {
        "cycleLabel": cycle_label(rows), "initialStock": INITIAL_STOCK, "stockingWeight": stocking_g,
        # Week-1 logs are end-of-week now, so the stocking range is +-20% of the stocking weight.
        "stockingWeightMin": round(stocking_g * 0.8, 1), "stockingWeightMax": round(stocking_g * 1.2, 1),
        "cycleStart": start, "cycleEnd": start + timedelta(days=GROWOUT_DAYS), "timestamp": now,
        "survivalRate": round(survival, 2), "avgWeightPerPiece": latest_g, "costPerKg": 246,
        "expectedYield": round(INITIAL_STOCK * survival / 100 * latest_g / 1000, 2),
        "generatedBy": "system", "summaryNote": "No notes yet"}))
    docs.append(("settings/thresholds", dict(THRESHOLDS)))

    last = readings[-1][1]
    docs.append(("Aquaponics/Ulang", {**{k: last[k] for k in [*WATER, "salinityPpt", "waterLevel"]},
                                      "measuredAt": last["measuredAt"], "date": last["date"], "time": last["time"]}))

    daily_g = (INITIAL_STOCK - deaths) * latest_g * optimal_feed_rate(latest_g) / 100
    for i, ft in enumerate(FEED_TIMES):
        docs.append((f"feeding_schedules/demo-feed-{i + 1}", {"feedTime": ft, "feedType": "Pellet Feed",
                     "amount": math.floor(daily_g / len(FEED_TIMES)), "enabled": True,
                     "createdBy": admin["uid"], "createdAt": start}))
    for day in range(6, -1, -1):
        d = now.date() - timedelta(days=day)
        times = [datetime.combine(d, datetime.strptime(ft, "%H:%M").time(), PHT) for ft in FEED_TIMES]
        for n, t in enumerate([t for t in times if t <= now], 1):
            docs.append((f"ActionLogs/Ulang/years/action_{d:%Y}/action_{d:%m}/action_{d:%d}/actions/action_{n:04d}", {
                "action": "FEED", "triggerReason": f"Scheduled feed {t:%H:%M}", "durationMs": 4000, "status": "completed",
                "date": f"{d:%Y-%m-%d}", "time": f"{t:%H:%M:%S}", "completedAt": t, "physicalActuatorEnabled": False}))

    week_mid = lambda w: start + timedelta(days=7 * (w - 1) + 3, hours=14)
    for doc_id, param, w, col, safe, sev, msg in [
        ("demo-alert-do-w08", "dissolvedOxygen", 8, "avgDissolvedOxygen", "> 5 mg/L", "medium", "Dissolved oxygen below the safe range. Increase aeration."),
        ("demo-alert-temp-w09", "waterTemp", 9, "avgWaterTemp", "22 – 32°C", "low", "Water temperature above the safe range. Add shade."),
        ("demo-alert-do-w14", "dissolvedOxygen", 14, "avgDissolvedOxygen", "> 5 mg/L", "medium", "Dissolved oxygen below the safe range. Increase aeration."),
    ]:
        if w <= weeks_seeded:
            docs.append((f"alerts/{doc_id}", {"type": "out_of_range", "parameter": param, "currentValue": round(float(rows.loc[w, col]), 2),
                         "safeRange": safe, "message": msg, "severity": sev, "status": "resolved", "createdAt": week_mid(w),
                         "resolvedAt": week_mid(w) + timedelta(hours=6), "deviceId": DEVICE_ID}))

    task = lambda doc_id, title, desc, status, due: (f"tasks/{doc_id}", {
        "title": title, "description": desc, "assignedTo": tech["uid"], "assignedToName": tech["name"],
        "assignedToRole": "technician", "assignedBy": admin["uid"], "createdBy": admin["uid"],
        "dueDate": f"{due:%Y-%m-%d}", "status": status, "createdAt": datetime.combine(due - timedelta(days=2), datetime.min.time(), PHT)})
    today = now.date()
    docs += [task("demo-task-1", "Check aerator", "Low DO logged in week 14; inspect the air stone and pump.", "done", today - timedelta(days=5)),
             task("demo-task-2", "Clean turbidity probe", "Rinse and dry the probe before the next reading.", "done", today - timedelta(days=2)),
             task("demo-task-3", "Partial water change (20%)", "Replace 20% of tank water; log TDS after.", "pending", today + timedelta(days=1)),
             task("demo-task-4", "Weekly weigh-in", "Weigh 10-12 ulang and log each in the app.", "pending", today + timedelta(days=2))]

    for role, u in (("admin", admin), ("technician", tech)):
        docs.append((f"users/{u['uid']}", {"email": u["email"], "fullName": u["name"], "role": role, "status": "active",
                                           "emailVerified": True, "createdAt": start}))
    return docs, start, readings, reading_weeks


def check_weekly_means(rows, readings, weeks):
    """Largest |seeded weekly mean - dataset row| per parameter, over full weeks only."""
    full = [w for w in np.unique(weeks) if (weeks == w).sum() == 168]
    for field, (col, *_) in WATER.items():
        vals = np.array([d[field] for _, d in readings])
        err = max(abs(vals[weeks == w].mean() - rows.loc[w, col]) for w in full)
        print(f"[CHECK] {field}: weekly mean within {err:.4f} of the dataset row ({len(full)} full weeks)")


def main():
    parser = argparse.ArgumentParser(description="Seed bantay-ulang-demo from dataset cycle 1 (dry run by default).")
    parser.add_argument("--write", action="store_true", help="commit the writes (default: dry run)")
    parser.add_argument("--reset", action="store_true", help="with --write, delete the seeded collections first")
    parser.add_argument("--admin-email", help="demo admin Auth email (required with --write)")
    parser.add_argument("--tech-email", help="demo technician Auth email (required with --write)")
    parser.add_argument("--weeks", type=int, default=15, help="full weeks to seed (cycle day = 7 x weeks)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cycle-file", help=f"CSV with one 18-week cycle in {DATASET}'s format (default: cycle {CYCLE_ID})")
    args = parser.parse_args()
    if args.write and not (args.admin_email and args.tech_email):
        parser.error("--write needs --admin-email and --tech-email")

    rows = load_cycle(args.cycle_file)
    if not 13 <= args.weeks < len(rows):
        parser.error(f"--weeks must be 13..{len(rows) - 1} (past day 90, with a next-week row for today)")
    now = datetime.now(PHT).replace(minute=0, second=0, microsecond=0)

    db = None
    if args.write:
        db = connect_firestore(DEMO_PROJECT)  # stops unless the key and client are bantay-ulang-demo
        from firebase_admin import auth
        admin, tech = ({"uid": auth.get_user_by_email(e).uid, "email": e, "name": n}
                       for e, n in ((args.admin_email, "Demo Admin"), (args.tech_email, "Demo Technician")))
    else:
        admin = {"uid": "<admin-uid>", "email": "<admin-email>", "name": "Demo Admin"}
        tech = {"uid": "<tech-uid>", "email": "<tech-email>", "name": "Demo Technician"}

    docs, start, readings, weeks = build(rows, args.weeks, now, admin, tech, np.random.default_rng(args.seed))
    counts = pd.Series([p.split("/")[0] for p, _ in docs]).value_counts()
    print(f"\n[PLAN] {cycle_label(rows)}: cycleStart {start:%Y-%m-%d} PHT, day {(now.date() - start.date()).days}, "
          f"readings through {now:%Y-%m-%d %H:00} PHT")
    print(counts.to_string())
    print(f"[PLAN] TOTAL WRITES: {len(docs)}" + (" (+ deletes from --reset)" if args.reset else ""))
    check_weekly_means(rows, readings, weeks)

    if not args.write:
        print("\n[DRY RUN] Nothing written. Add --write to commit.")
        return
    if not args.reset and list(db.collection("growth_indicators").limit(1).stream()):
        raise SystemExit("[STOP] growth_indicators already has a doc; re-run with --reset to re-seed.")
    action = f"delete {', '.join(SEEDED)} and write" if args.reset else "write"
    if input(f"Type 'seed' to {action} {len(docs)} docs in {DEMO_PROJECT}: ").strip() != "seed":
        raise SystemExit("[STOP] Not confirmed; nothing changed.")
    if args.reset:
        for name in SEEDED:
            print(f"[RESET] {name}: deleted {db.recursive_delete(db.collection(name))} docs")
    for i in range(0, len(docs), 500):
        batch = db.batch()
        for path, data in docs[i:i + 500]:
            batch.set(db.document(path), data)
        batch.commit()
        print(f"[WRITE] {min(i + 500, len(docs))}/{len(docs)}")
    print("[OK] Demo seeded. Next: python predict_yield.py --project bantay-ulang-demo")


if __name__ == "__main__":
    main()
