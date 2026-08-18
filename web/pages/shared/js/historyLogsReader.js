import { db } from "./firebase.js";
import {
    collectionGroup,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
 * historyLogsReader.js — read-only Firestore data layer for HistoryLogs.
 *
 * Readings live at:
 *   HistoryLogs/Ulang/years/reading_YYYY/reading_MM/reading_DD/readings/reading_NNN
 * and are fetched via collectionGroup("readings") — same approach proven by
 * ml-analytics/predict_yield.py. Each doc's shape mirrors the Aquaponics/
 * Ulang live doc (see aquaponicsReading.js): statistics.*.average for the
 * numeric params, statistics.WaterLevel.latest for the boolean water level.
 *
 * IMPORTANT — measuredAt is UNCONFIRMED for HistoryLogs docs:
 * predict_yield.py (the only other code in this repo that reads these docs)
 * never touches a timestamp field — it paginates blindly with limit() +
 * start_after() and only reads `statistics`. There is no writer code in this
 * repo to check either (the ESP32/ingestion side isn't here). Before relying
 * on this module, open one reading_NNN doc in the Firestore console and
 * confirm it actually has a `measuredAt` field of type Timestamp. If the
 * real field is named differently (e.g. `timestamp`, `recordedAt`), update
 * the `where`/`orderBy` calls in fetchNewReadings() and the read in
 * normalizeHistoryReading() to match.
 *
 * This module ONLY reads from Firestore — no writes, no IndexedDB/cache
 * logic (that's cacheStore.js, wired together in Part 4).
 */

const READINGS_COLLECTION_GROUP = "readings";
const DEFAULT_FETCH_LIMIT = 1000;

/**
 * normalizeHistoryReading(docData)
 *
 * docData = a HistoryLogs reading doc's data() (or undefined/null). Never
 * throws on a missing `statistics` object or any missing sub-field —
 * everything falls back to null. Mirrors the flat-object shape produced by
 * aquaponicsReading.js's normalizeAquaponicsReading(), except measuredAt is
 * converted to milliseconds (measuredAtMs) so it can be used directly as
 * cacheStore.js's IndexedDB keyPath.
 *
 * waterLevel is true | false | null (boolean safe/unsafe state, not depth).
 */
export function normalizeHistoryReading(docData) {
    const stats = docData?.statistics ?? {};
    const measuredAt = docData?.measuredAt;
    const measuredAtMs =
        typeof measuredAt?.toMillis === "function" ? measuredAt.toMillis() : null;

    return {
        measuredAtMs,
        waterTemp:       stats.waterTemperatureC?.average ?? null,
        ph:              stats.phValue?.average ?? null,
        dissolvedOxygen: stats.oxygenLevelMgL?.average ?? null,
        tds:             stats.tdsPpm?.average ?? null,
        turbidity:       stats.turbidityNTU?.average ?? null,
        salinity:        stats.salinityPpt?.average ?? null,
        waterLevel:      stats.WaterLevel?.latest ?? null
    };
}

/**
 * fetchNewReadings(sinceMs)
 *
 * Incremental fetch: queries collectionGroup("readings") for docs with
 * measuredAt > sinceMs, ordered ascending, capped at DEFAULT_FETCH_LIMIT
 * (1000) per call to avoid a huge single read — same caution as
 * predict_yield.py's BATCH/MAX_READINGS guardrail.
 *
 * If sinceMs is null/undefined (no prior sync / no local cache yet), treated
 * as 0 — fetch from the very beginning of the collection group, up to the
 * limit. There is deliberately no "recent window" default: this project's
 * deployment model starts fresh with no backfill, so "from the beginning"
 * on a real deployment just means "since live data began" anyway. A
 * recent-days default would also wrongly exclude older-dated synthetic test
 * data during development.
 *
 * Docs missing/with a malformed measuredAt are dropped (normalizeHistoryReading
 * would otherwise return measuredAtMs: null, which can't be used as the
 * IndexedDB keyPath in cacheStore.js).
 *
 * NOTE: if a call returns exactly DEFAULT_FETCH_LIMIT readings, there may be
 * more beyond the cap — callers doing a large backfill should re-call with
 * sinceMs = the last returned reading's measuredAtMs to page through.
 *
 * Requires a Firestore composite index — see the module-level flag below.
 * Returns [] (and logs the error) if the query fails, e.g. index missing.
 */
export async function fetchNewReadings(sinceMs) {
    const effectiveSinceMs = sinceMs ?? 0;
    const sinceTimestamp = Timestamp.fromMillis(effectiveSinceMs);

    const readingsQuery = query(
        collectionGroup(db, READINGS_COLLECTION_GROUP),
        where("measuredAt", ">", sinceTimestamp),
        orderBy("measuredAt", "asc"),
        limit(DEFAULT_FETCH_LIMIT)
    );

    try {
        const snapshot = await getDocs(readingsQuery);
        return snapshot.docs
            .map((doc) => normalizeHistoryReading(doc.data()))
            .filter((reading) => reading.measuredAtMs != null);
    } catch (error) {
        console.error("historyLogsReader: fetchNewReadings failed.", error);
        return [];
    }
}
