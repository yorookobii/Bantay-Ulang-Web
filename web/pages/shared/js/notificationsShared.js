import { reevaluateActiveAlerts } from './alertsEngine.js';
import { getActiveAlerts } from './alertState.js';

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
    tds: 'TDS',
    hardware: 'System Hardware'
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

// Newest 15 active alerts; the bell and the "View All Alerts" page share this cap so their lists match.
export function newestAlerts(alerts) {
    return [...alerts]
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 15);
}

// "View All Alerts" only: resolves stale alerts first (reevaluate invalidates alertState when it writes).
export async function fetchActiveAlerts() {
    await reevaluateActiveAlerts();
    return newestAlerts(await getActiveAlerts());
}

export function updateBadge(badgeEl, unseenCount) {
    if (!badgeEl) return;
    badgeEl.textContent = unseenCount > 9 ? '9+' : String(unseenCount);
    badgeEl.style.display = unseenCount > 0 ? 'inline-block' : 'none';
    badgeEl.closest('.notification-icon')?.setAttribute('aria-label',
        unseenCount > 0 ? `Notifications, ${unseenCount} unseen` : 'Notifications');
}
