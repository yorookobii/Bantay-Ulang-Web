import { db } from './firebase.js';
import {
    collection,
    query,
    where,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { reevaluateActiveAlerts } from './alertsEngine.js';

// localStorage analog of Flutter's SharedPreferences seen-notification set
// (see notification_service.dart / landing_page.dart) — same key, same
// "alert:<docId>" entry format, so seen state has the same shape on both.
export const SEEN_KEY = 'seen_notification_keys';

export const SEVERITY_ICON = {
    critical: { icon: 'fa-solid fa-triangle-exclamation', color: '#dc2626' },
    high:     { icon: 'fa-solid fa-circle-exclamation',   color: '#ea580c' },
    medium:   { icon: 'fa-solid fa-circle-exclamation',   color: '#d97706' },
    low:      { icon: 'fa-solid fa-circle-info',          color: '#2563eb' }
};

// Human-readable alert parameter labels, shared so the bell and the
// "View All Alerts" page (and any future consumer) never disagree on
// how a parameter is displayed (e.g. "pH Level", not "Ph Level").
export const PARAM_LABELS = {
    phLevel: 'pH Level',
    waterTemp: 'Water Temperature',
    dissolvedOxygen: 'Dissolved Oxygen',
    salinity: 'Salinity',
    turbidity: 'Turbidity',
    waterLevel: 'Water Level',
    tds: 'TDS'
};

export function getSeenKeys() {
    try {
        return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []);
    } catch (_) {
        return new Set();
    }
}

export function markSeen(keys) {
    const seen = getSeenKeys();
    keys.forEach((key) => seen.add(key));
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch (_) {}
}

export function computeUnseenCount(alerts) {
    const seen = getSeenKeys();
    return alerts.filter((alert) => !seen.has(`alert:${alert.id}`)).length;
}

export function formatRelativeTime(date) {
    if (!date) return '';
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export async function fetchActiveAlerts() {
    // Filters by status only (matches dashboard.js:232-239) so no composite
    // Firestore index is required; sort/limit happen client-side instead.
    // Capped at 15: both the bell dropdown and the "View All Alerts" page
    // call this same function so their badge counts always match. If active
    // alert volume grows past 15, this cap will need decoupling (e.g. a
    // limit parameter) so "View All" can show everything without the bell
    // undercounting - not needed at current alert volume.
    await reevaluateActiveAlerts();
    const snap = await getDocs(query(collection(db, 'alerts'), where('status', '==', 'active')));
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 15);
}

export function updateBadge(badgeEl, unseenCount) {
    if (!badgeEl) return;
    badgeEl.textContent = unseenCount > 9 ? '9+' : String(unseenCount);
    badgeEl.style.display = unseenCount > 0 ? 'inline-block' : 'none';
}
