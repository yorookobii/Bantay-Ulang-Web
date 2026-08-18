import * as cacheStore from "./cacheStore.js";
import { fetchNewReadings } from "./historyLogsReader.js";

/*
 * readingsService.js — integration layer combining cacheStore.js (local
 * IndexedDB cache) and historyLogsReader.js (incremental Firestore fetch)
 * into one simple API for charts/tables to call.
 *
 * This module orchestrates ONLY — every cache read/write goes through
 * cacheStore.js and every Firestore read goes through historyLogsReader.js.
 * No direct IndexedDB or Firestore calls live here.
 *
 * Graceful degradation: cacheStore.js already no-ops/returns empty when
 * IndexedDB is unavailable (private browsing, disabled storage, etc). When
 * that happens, the final "read everything back from cache" step here would
 * normally return [] even though we just fetched real data — so both
 * exported functions fall back to the freshly fetched readings directly in
 * that case, ensuring charts still work (just without the caching benefit).
 */

/**
 * reconcileCycleStart(currentCycleStartMs)
 *
 * Internal — cache invalidation. Compares currentCycleStartMs against the
 * cached cycleStart (cacheStore meta):
 *   - no currentCycleStartMs given: no-op, leaves the cache as-is.
 *   - no cached cycleStart yet: just records currentCycleStartMs.
 *   - cached cycleStart differs from currentCycleStartMs: the cache belongs
 *     to a previous grow cycle and is stale, so clear it first, then record
 *     the new cycleStart.
 *   - cached cycleStart matches: nothing to do, cache is still valid.
 */
async function reconcileCycleStart(currentCycleStartMs) {
    if (currentCycleStartMs == null) return;

    const cachedCycleStart = await cacheStore.getCachedCycleStart();
    if (cachedCycleStart === currentCycleStartMs) return;

    if (cachedCycleStart != null) {
        await cacheStore.clearCache();
    }
    await cacheStore.setCachedCycleStart(currentCycleStartMs);
}

/**
 * syncCache(currentCycleStartMs)
 *
 * Internal — runs the invalidate → incremental-fetch → merge/persist
 * sequence shared by both exported functions:
 *   1. reconcileCycleStart() (see above).
 *   2. Reads cacheStore.getLastSync() and fetches only readings newer than
 *      that via historyLogsReader.fetchNewReadings() (fetches from the
 *      beginning if lastSync is null — see historyLogsReader.js).
 *   3. If any new readings came back, persists them via
 *      cacheStore.saveReadings() and advances lastSync to the newest
 *      reading's measuredAtMs.
 *
 * Returns the array of newly fetched readings (ascending by measuredAtMs,
 * possibly empty) — callers combine this with a cache read for the final
 * result, falling back to this array directly if the cache is unavailable.
 */
async function syncCache(currentCycleStartMs) {
    await reconcileCycleStart(currentCycleStartMs);

    const lastSync = await cacheStore.getLastSync();
    const newReadings = await fetchNewReadings(lastSync);

    if (newReadings.length > 0) {
        await cacheStore.saveReadings(newReadings);
        const newest = newReadings[newReadings.length - 1].measuredAtMs;
        await cacheStore.setLastSync(newest);
    }

    return newReadings;
}

/**
 * getReadings(currentCycleStartMs)
 *
 * The main function charts call. Ensures the local cache reflects the
 * current grow cycle and is caught up with Firestore (see syncCache()),
 * then returns the complete dataset — old cached readings plus whatever was
 * just synced — sorted ascending by measuredAtMs.
 *
 * currentCycleStartMs is optional; pass it whenever it's known so stale
 * data from a previous cycle gets invalidated. Omit it (or pass null) to
 * skip invalidation and just sync/read against whatever cycle is currently
 * cached.
 *
 * If the cache is unavailable, returns the freshly fetched readings
 * directly instead of an empty array. Returns [] cleanly if there is no
 * data at all (empty cache + nothing new to fetch).
 */
export async function getReadings(currentCycleStartMs) {
    const newReadings = await syncCache(currentCycleStartMs);

    const cached = await cacheStore.getReadings();
    if (cached.length > 0) return cached;

    return newReadings;
}

/**
 * getReadingsInRange(cycleStartMs, sinceMs, untilMs)
 *
 * Same sync behavior as getReadings(), but returns only the readings whose
 * measuredAtMs falls within [sinceMs, untilMs] — intended for the history
 * table's date-range search, so it doesn't need to pull the entire cached
 * dataset just to filter it client-side.
 *
 * Falls back to filtering the freshly fetched readings (from this sync) by
 * the same range if the cache is unavailable, matching getReadings()'s
 * degradation behavior.
 */
export async function getReadingsInRange(cycleStartMs, sinceMs, untilMs) {
    const newReadings = await syncCache(cycleStartMs);

    const ranged = await cacheStore.getReadings(sinceMs, untilMs);
    if (ranged.length > 0) return ranged;

    return newReadings.filter((reading) => {
        if (sinceMs != null && reading.measuredAtMs < sinceMs) return false;
        if (untilMs != null && reading.measuredAtMs > untilMs) return false;
        return true;
    });
}
