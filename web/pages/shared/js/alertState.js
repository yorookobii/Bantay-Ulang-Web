import { db } from './firebase.js';
import {
    collection,
    query,
    where,
    getDocs,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Shared active-alerts store: one read-only status=='active' query, cached per tab for 60 s.
// Never writes; code that resolves, creates or hands off alerts calls invalidate().

const CACHE_KEY = 'bantay-ulang-active-alerts';
const MAX_AGE_MS = 60 * 1000;
// Only the fields the bell, dashboard and All Alerts read are kept (no handledBy uid etc.).
const FIELDS = ['type', 'parameter', 'severity', 'status', 'message', 'currentValue', 'safeRange',
    'createdAt', 'lastSeenAt', 'handledAt', 'excludeFromReports'];

let current = null;
let generation = 0;
let inflight = null;
const subscribers = new Set();

function pick(id, data) {
    const alert = { id };
    FIELDS.forEach((key) => { if (data[key] !== undefined) alert[key] = data[key]; });
    return alert;
}

function toStored(alert) {
    const out = {};
    Object.entries(alert).forEach(([key, value]) => {
        out[key] = typeof value?.toMillis === 'function' ? { __ms: value.toMillis() } : value;
    });
    return out;
}

function fromStored(alert) {
    const out = {};
    Object.entries(alert).forEach(([key, value]) => {
        out[key] = value && typeof value.__ms === 'number' ? Timestamp.fromMillis(value.__ms) : value;
    });
    return out;
}

function readCache() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
        const age = Date.now() - cached?.at;
        if (!Array.isArray(cached?.alerts) || !(age >= 0 && age < MAX_AGE_MS)) return null;
        return cached.alerts.map(fromStored);
    } catch (_) {
        return null;
    }
}

function setCurrent(alerts, persist) {
    current = alerts;
    if (persist) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), alerts: alerts.map(toStored) }));
        } catch (_) {}
    }
    subscribers.forEach((fn) => {
        try { fn(alerts); } catch (err) { console.error('alertState subscriber failed:', err); }
    });
}

/** Fetches fresh active alerts, sharing one request per invalidation generation. */
export function refresh() {
    if (inflight?.generation === generation) return inflight.promise;
    const myGeneration = generation;
    const promise = getDocs(query(collection(db, 'alerts'), where('status', '==', 'active')))
        .then((snap) => {
            const alerts = snap.docs.map((docSnap) => pick(docSnap.id, docSnap.data()));
            // A result that started before invalidate() is returned but never cached.
            if (myGeneration === generation) setCurrent(alerts, true);
            return alerts;
        })
        .finally(() => { if (inflight?.promise === promise) inflight = null; });
    inflight = { generation: myGeneration, promise };
    return promise;
}

/** Active alerts from memory, then the 60 s tab cache, else one fresh query. */
export async function getActiveAlerts() {
    if (current) return current;
    const cached = readCache();
    if (cached) {
        setCurrent(cached, false);
        return cached;
    }
    return refresh();
}

/** Drops the cache; refetches at once only if something on this page is subscribed. */
export function invalidate() {
    generation++;
    current = null;
    try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
    if (subscribers.size) refresh().catch((err) => console.warn('alertState: refresh after invalidate failed.', err));
}

/** Calls fn with every new alert list; returns an unsubscribe function. */
export function subscribe(fn) {
    subscribers.add(fn);
    if (current) fn(current);
    return () => subscribers.delete(fn);
}

/** Counting rule shared by every alert count: all active minus excludeFromReports duplicates. */
export function countAlerts(alerts) {
    const counted = alerts.filter((alert) => alert.excludeFromReports !== true);
    return { active: counted.length, handled: counted.filter((alert) => alert.handledAt != null).length };
}
