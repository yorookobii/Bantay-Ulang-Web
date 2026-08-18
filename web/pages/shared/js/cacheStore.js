/*
 * cacheStore.js — local IndexedDB cache for HistoryLogs readings.
 *
 * Pure IndexedDB, no Firestore and no chart code. This module only knows how
 * to persist/retrieve readings and a couple of meta values (lastSync,
 * cycleStart) on the client so history charts can render instantly from
 * cache before/instead of waiting on a Firestore read.
 *
 * IndexedDB can be unavailable (private browsing in some browsers, disabled
 * storage, etc). Every exported function degrades gracefully in that case —
 * it logs a warning and resolves to a harmless empty/no-op value instead of
 * throwing, so callers don't need to special-case "no cache".
 */

const DB_NAME = "BantayUlangCache";
const DB_VERSION = 1;
const READINGS_STORE = "readings";
const META_STORE = "meta";

let dbPromise = null;

/**
 * openDB()
 *
 * Opens (creating if needed) the BantayUlangCache IndexedDB database with
 * two object stores: 'readings' (keyPath: measuredAtMs) and 'meta'
 * (keyPath: key). Memoized — safe to call from every other function in this
 * module without opening a new connection each time.
 *
 * Resolves to null (instead of rejecting) if IndexedDB isn't available or
 * fails to open, so callers can treat "no cache" as a normal case.
 */
export function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        if (!("indexedDB" in window)) {
            console.warn("cacheStore: IndexedDB unavailable, caching disabled.");
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(READINGS_STORE)) {
                db.createObjectStore(READINGS_STORE, { keyPath: "measuredAtMs" });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn("cacheStore: failed to open IndexedDB, caching disabled.", request.error);
            resolve(null);
        };
    });

    return dbPromise;
}

/**
 * saveReadings(readings)
 *
 * Writes an array of reading objects (each must include measuredAtMs) into
 * the 'readings' store in one transaction. Uses put(), so re-saving a
 * measuredAtMs already in the store overwrites it instead of erroring —
 * safe to call repeatedly with overlapping data.
 *
 * No-ops (resolves immediately) if the cache is unavailable or the array is
 * empty.
 */
export async function saveReadings(readings) {
    if (!Array.isArray(readings) || readings.length === 0) return;

    const db = await openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(READINGS_STORE, "readwrite");
        const store = tx.objectStore(READINGS_STORE);

        readings.forEach((reading) => store.put(reading));

        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            console.warn("cacheStore: saveReadings transaction failed.", tx.error);
            reject(tx.error);
        };
    });
}

/**
 * getReadings(sinceMs, untilMs)
 *
 * Returns all cached readings with measuredAtMs within [sinceMs, untilMs],
 * sorted ascending by measuredAtMs. Both bounds are optional — omit either
 * (or both) to get an open-ended/unbounded range. Uses an IDBKeyRange so the
 * lookup is a single indexed cursor scan rather than a full-store filter.
 *
 * Resolves to [] if the cache is unavailable, empty, or on error.
 */
export async function getReadings(sinceMs, untilMs) {
    const db = await openDB();
    if (!db) return [];

    let range;
    if (sinceMs != null && untilMs != null) range = IDBKeyRange.bound(sinceMs, untilMs);
    else if (sinceMs != null) range = IDBKeyRange.lowerBound(sinceMs);
    else if (untilMs != null) range = IDBKeyRange.upperBound(untilMs);
    else range = null;

    return new Promise((resolve) => {
        const tx = db.transaction(READINGS_STORE, "readonly");
        const store = tx.objectStore(READINGS_STORE);
        const request = range ? store.getAll(range) : store.getAll();

        request.onsuccess = () => {
            const results = request.result || [];
            results.sort((a, b) => a.measuredAtMs - b.measuredAtMs);
            resolve(results);
        };
        request.onerror = () => {
            console.warn("cacheStore: getReadings failed.", request.error);
            resolve([]);
        };
    });
}

/**
 * getMeta(key)
 *
 * Internal helper — reads meta[key].value, or null if unset/unavailable.
 */
async function getMeta(key) {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(META_STORE, "readonly");
        const request = tx.objectStore(META_STORE).get(key);

        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => {
            console.warn(`cacheStore: getMeta(${key}) failed.`, request.error);
            resolve(null);
        };
    });
}

/**
 * setMeta(key, value)
 *
 * Internal helper — writes meta[key].value. No-ops if the cache is
 * unavailable.
 */
async function setMeta(key, value) {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(META_STORE, "readwrite");
        tx.objectStore(META_STORE).put({ key, value });

        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            console.warn(`cacheStore: setMeta(${key}) failed.`, tx.error);
            reject(tx.error);
        };
    });
}

/**
 * getLastSync()
 *
 * Returns the numeric ms timestamp of the last successful sync, or null if
 * unset/unavailable.
 */
export function getLastSync() {
    return getMeta("lastSync");
}

/**
 * setLastSync(ms)
 *
 * Records the numeric ms timestamp of the last successful sync.
 */
export function setLastSync(ms) {
    return setMeta("lastSync", ms);
}

/**
 * getCachedCycleStart()
 *
 * Returns the numeric ms timestamp of the cycle the cache was built for, or
 * null if unset/unavailable. Used to detect a new grow cycle so the cache
 * can be invalidated (see clearCache()).
 */
export function getCachedCycleStart() {
    return getMeta("cycleStart");
}

/**
 * setCachedCycleStart(ms)
 *
 * Records the numeric ms timestamp of the cycle the cache was built for.
 */
export function setCachedCycleStart(ms) {
    return setMeta("cycleStart", ms);
}

/**
 * clearCache()
 *
 * Clears both the 'readings' and 'meta' stores. Intended for use when a new
 * grow cycle starts and the previous cycle's cached readings/meta are no
 * longer valid.
 *
 * No-ops if the cache is unavailable.
 */
export async function clearCache() {
    const db = await openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction([READINGS_STORE, META_STORE], "readwrite");
        tx.objectStore(READINGS_STORE).clear();
        tx.objectStore(META_STORE).clear();

        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            console.warn("cacheStore: clearCache transaction failed.", tx.error);
            reject(tx.error);
        };
    });
}
