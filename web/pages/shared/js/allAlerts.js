import {
    fetchActiveAlerts,
    markSeen,
    computeUnseenCount,
    updateBadge,
    getSeenKeys,
    SEVERITY_ICON,
    formatRelativeTime,
    PARAM_LABELS
} from './notificationsShared.js';
import { getReadingsInRange } from './readingsService.js';
import { db } from './firebase.js';
import { initSidebar } from './sidebar.js';
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Parameter unit lookup for clean telemetry readout
const PARAM_UNITS = {
    phLevel: '',
    waterTemp: '°C',
    dissolvedOxygen: 'mg/L',
    salinity: 'ppt',
    turbidity: 'NTU',
    waterLevel: 'm',
    tds: 'ppm'
};

// ── Sparkline config — every tuning knob in one place ───────────────────────
const SPARK_LEAD_MS = 24 * 60 * 60 * 1000;          // window starts this far BEFORE the breach
const SPARK_TRAIL_MS = 72 * 60 * 60 * 1000;         // ...and extends this far AFTER it (clamped to now)
const SPARK_MAX_POINTS = 48;                        // downsample target — a sparkline past this is mush
const SPARK_W = 96;
const SPARK_H = 40;
const SPARK_PAD = 4;
const READINGS_FALLBACK_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // used only if there is no cycleStart

// alert.parameter -> normalized reading-object key (historyLogsReader.js:58-67).
// Only phLevel differs; every other parameter passes through unchanged.
const PARAM_TO_READING_KEY = { phLevel: 'ph' };
const readingKeyFor = (parameter) => PARAM_TO_READING_KEY[parameter] || parameter;

// Numeric params that have a reading-object series. waterLevel is excluded — it
// is boolean (WaterLevel.latest), so it gets a state indicator, not a sparkline.
const SPARK_NUMERIC_KEYS = ['waterTemp', 'ph', 'dissolvedOxygen', 'tds', 'turbidity', 'salinity'];

// Built once per page load by loadReadingsIndex(); null until then, {} on failure.
let readingsByParam = null;

// Group categories by alert type
const TYPE_GROUPS = {
    critical_out_of_range: { label: 'Critical Alerts', order: 0 },
    out_of_range:          { label: 'Warning Alerts',  order: 1 }
};

function groupByType(alerts) {
    const groups = {};
    alerts.forEach((alert) => {
        const key = TYPE_GROUPS[alert.type] ? alert.type : 'out_of_range';
        (groups[key] = groups[key] || []).push(alert);
    });
    // Within each group, keep active alerts on top and handled ones (handledAt
    // set by Assign Actions) at the bottom. Stable sort preserves the existing
    // createdAt-desc order within each partition.
    Object.keys(groups).forEach((key) => {
        groups[key].sort((a, b) => (a.handledAt != null ? 1 : 0) - (b.handledAt != null ? 1 : 0));
    });
    return groups;
}

/**
 * Computes resolution metrics dynamically from loaded alerts and seen status.
 */
function computeOverviewMetrics(alerts) {
    const criticalAlerts = alerts.filter(
        (a) => a.severity === 'critical' || a.type === 'critical_out_of_range'
    );
    const warningAlerts = alerts.filter(
        (a) => !(a.severity === 'critical' || a.type === 'critical_out_of_range')
    );

    // An alert counts as done once a human assigned an action for it (handledAt)
    // or the sensor recovered (status resolved, set by the alertsEngine).
    const isDone = (a) => a.handledAt != null || a.status === 'resolved';

    const resolvedCritical = criticalAlerts.filter(isDone).length;
    const totalCritical = criticalAlerts.length;
    const criticalPct = totalCritical > 0
        ? Math.round((resolvedCritical / totalCritical) * 100)
        : 100;

    const resolvedWarning = warningAlerts.filter(isDone).length;
    const totalWarning = warningAlerts.length;
    const warningPct = totalWarning > 0
        ? Math.round((resolvedWarning / totalWarning) * 100)
        : 100;

    const totalAll = alerts.length;
    const resolvedAll = resolvedCritical + resolvedWarning;
    const totalPct = totalAll > 0
        ? Math.round((resolvedAll / totalAll) * 100)
        : 100;

    return {
        critical: { resolved: resolvedCritical, total: totalCritical, pct: criticalPct },
        warning:  { resolved: resolvedWarning,  total: totalWarning,  pct: warningPct },
        total:    { resolved: resolvedAll,      total: totalAll,      pct: totalPct }
    };
}

/**
 * Renders an individual 56x56 circular progress gauge summary card.
 */
function renderOverviewCard({ title, resolved, total, pct, strokeClass, countVerb, subtext }) {
    const circumference = 144.5;
    const dashoffset = (circumference * (1 - (pct / 100))).toFixed(1);

    return `
    <div class="overview-gauge-card">
        <!-- 56x56px Progress Gauge with Dark Background Track -->
        <div class="overview-ring-wrap" aria-hidden="true">
            <svg class="overview-ring-svg" viewBox="0 0 56 56" width="56" height="56">
                <circle class="overview-track" cx="28" cy="28" r="23" />
                <circle class="overview-fill ${strokeClass}"
                        cx="28" cy="28" r="23"
                        stroke-dasharray="144.5"
                        stroke-dashoffset="${dashoffset}" />
                <text class="overview-pct-text" x="28" y="28" text-anchor="middle" dominant-baseline="central">
                    ${pct}%
                </text>
            </svg>
        </div>

        <!-- Metric Labels & Fractional Count -->
        <div class="overview-info">
            <span class="overview-title">${title}</span>
            <div class="overview-fraction">
                <strong>${resolved}</strong> of <strong>${total}</strong> ${countVerb}
            </div>
            <span class="overview-subtext">${subtext}</span>
        </div>
    </div>`;
}

/**
 * Formats sensor values cleanly with parameter unit.
 */
function formatCurrentValue(val, parameter) {
    if (val == null || val === '—') return '—';
    const num = Number(val);
    if (isNaN(num)) return String(val);

    const formattedNum = Number.isInteger(num)
        ? num.toLocaleString()
        : num.toFixed(1);

    const unit = PARAM_UNITS[parameter];
    return unit ? `${formattedNum} ${unit}` : formattedNum;
}

// ── Reading-history sparklines ─────────────────────────────────────────────

function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Newest growth_indicators doc's cycleStart, in ms — mirrors dashboard.js:342-353
// and history.js:78-89. One doc read per page load.
async function loadCycleStartMs() {
    try {
        const snap = await getDocs(
            query(collection(db, 'growth_indicators'), orderBy('timestamp', 'desc'), limit(1))
        );
        if (snap.empty) return null;
        const cycleStart = toDateValue(snap.docs[0].data().cycleStart);
        return cycleStart ? cycleStart.getTime() : null;
    } catch (err) {
        console.warn('All Alerts: unable to load growth_indicators for cycleStart.', err);
        return null;
    }
}

// One-time fetch through the existing cached readings path (readingsService.js:115).
// Returns { waterTemp: [{t,v}...], ph: [...], ... } ascending by t.
async function loadReadingsIndex() {
    const cycleStartMs = await loadCycleStartMs();
    const sinceMs = cycleStartMs ?? (Date.now() - READINGS_FALLBACK_LOOKBACK_MS);
    const readings = await getReadingsInRange(cycleStartMs, sinceMs, Date.now());
    return buildSeriesIndex(readings);
}

function buildSeriesIndex(readings) {
    const idx = {};
    SPARK_NUMERIC_KEYS.forEach((k) => { idx[k] = []; });
    for (const r of readings) {
        if (r.measuredAtMs == null) continue;
        for (const k of SPARK_NUMERIC_KEYS) {
            const v = r[k];
            if (typeof v === 'number' && Number.isFinite(v)) idx[k].push({ t: r.measuredAtMs, v });
        }
    }
    return idx; // readingsService already returns ascending by measuredAtMs
}

// Even-stride downsample; always keeps the last point so "now" stays on screen.
function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const stride = Math.ceil(arr.length / max);
    const out = [];
    for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
    if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
    return out;
}

// Readings within [breachMs - SPARK_LEAD_MS, min(breachMs + SPARK_TRAIL_MS, now)]
// — anchored on the breach so a weeks-old alert still shows the trend where the
// data actually is. Downsampled to SPARK_MAX_POINTS; null if fewer than 2 points.
function windowedSeries(series, breachMs) {
    if (!series || series.length < 2 || breachMs == null) return null;
    const start = breachMs - SPARK_LEAD_MS;
    const end = Math.min(breachMs + SPARK_TRAIL_MS, Date.now());
    const win = series.filter((p) => p.t >= start && p.t <= end);
    if (win.length < 2) return null;
    return downsample(win, SPARK_MAX_POINTS);
}

function renderSparkPlaceholder(text) {
    return `<span class="alert-spark alert-spark--empty">${text}</span>`;
}

function renderWaterLevelIndicator(alert) {
    const unsafe = alert.currentValue === false;
    return `
    <span class="alert-spark alert-spark--wl ${unsafe ? 'is-unsafe' : 'is-safe'}">
        <span class="wl-dot"></span>${unsafe ? 'Unsafe' : 'Safe'}
    </span>`;
}

function renderSparkline(points, breachMs, sevClass, label) {
    const ts = points.map((p) => p.t);
    const vs = points.map((p) => p.v);
    const tMin = ts[0];
    const tMax = ts[ts.length - 1];
    let vMin = Math.min(...vs);
    let vMax = Math.max(...vs);
    if (vMin === vMax) { vMin -= 1; vMax += 1; } // flat-line guard

    const x = (t) => SPARK_PAD + (tMax === tMin ? 0 : (t - tMin) / (tMax - tMin)) * (SPARK_W - 2 * SPARK_PAD);
    const y = (v) => SPARK_H - SPARK_PAD - ((v - vMin) / (vMax - vMin)) * (SPARK_H - 2 * SPARK_PAD);

    const poly = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

    let bi = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
        const d = Math.abs(p.t - breachMs);
        if (d < bd) { bd = d; bi = i; }
    });
    const breachX = x(points[bi].t).toFixed(1);

    // width/height come from CSS (.alert-spark svg { width:100% }); preserveAspectRatio
    // "none" lets the 96x40 coordinate space stretch to fill the wider card slot.
    // The breach marker is a vertical tick (non-scaling-stroke) so it stays crisp
    // under the non-uniform stretch — a circle would render as an ellipse.
    return `
    <span class="alert-spark ${sevClass}" role="img" aria-label="Recent ${label} trend around breach">
        <svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none">
            <polyline points="${poly}" fill="none" stroke="currentColor" stroke-width="1.5"
                      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
            <line x1="${breachX}" x2="${breachX}" y1="${SPARK_PAD}" y2="${SPARK_H - SPARK_PAD}"
                  stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"
                  vector-effect="non-scaling-stroke" class="alert-spark-mark" />
        </svg>
    </span>`;
}

// Left-column content for a card: waterLevel indicator, loading/empty
// placeholder, or the sparkline once readings have resolved.
function renderCardSpark(alert, isCritical, paramLabel) {
    if (alert.parameter === 'waterLevel') return renderWaterLevelIndicator(alert);
    if (!readingsByParam) return renderSparkPlaceholder('loading trend…');

    const breachMs = alert.createdAt?.toMillis?.() ?? toDateValue(alert.createdAt)?.getTime() ?? null;
    const pts = windowedSeries(readingsByParam[readingKeyFor(alert.parameter)], breachMs);
    if (!pts) return renderSparkPlaceholder('no trend data');

    return renderSparkline(
        pts,
        breachMs,
        isCritical ? 'alert-spark--critical' : 'alert-spark--warning',
        paramLabel
    );
}

/**
 * Renders an individual discrete Circular Gauge alert card.
 */
function renderFeedCard(alert, seen) {
    const isCritical = alert.severity === 'critical' || alert.type === 'critical_out_of_range';
    const severityClass = isCritical ? 'severity-critical' : 'severity-warning';
    const badgeClass = isCritical ? 'af-badge--critical' : 'af-badge--warning';
    const badgeText = isCritical ? 'Critical' : 'Warning';
    const timeAgo = formatRelativeTime(alert.createdAt?.toDate?.());
    const isUnseen = !seen.has(`alert:${alert.id}`);
    const isHandled = alert.handledAt != null;
    const paramLabel = PARAM_LABELS[alert.parameter] || alert.parameter || 'Parameter';

    const formattedCurrentVal = formatCurrentValue(alert.currentValue, alert.parameter);
    const safeRangeStr = alert.safeRange || '—';
    const sparkHtml = renderCardSpark(alert, isCritical, paramLabel);

    // URL parameter routing to Assign Actions tab
    const routeUrl = `assign-actions.html?alert_id=${encodeURIComponent(alert.id)}&param=${encodeURIComponent(alert.parameter)}`;

    return `
    <div class="alert-ring-card ${severityClass}${isUnseen ? ' unseen' : ''}${isHandled ? ' handled' : ''}" data-alert-id="${alert.id}">
        <!-- Left: recent-trend sparkline around the breach (or indicator / placeholder) -->
        ${sparkHtml}

        <!-- Right: Parameter Title, Current vs Safe Readout, and Action Routing Link -->
        <div class="ring-card-content">
            <div class="ring-card-header">
                <h3 class="ring-card-title">${paramLabel}</h3>
                <span class="af-badge ${badgeClass}">${badgeText}</span>
                ${isHandled ? '<span class="af-badge af-badge--handled">Handled</span>' : ''}
            </div>

            <div class="ring-telemetry">
                <span class="telemetry-label">Current:</span>
                <strong class="telemetry-current">${formattedCurrentVal}</strong>
                <span class="telemetry-divider">&middot;</span>
                <span class="telemetry-label">Safe:</span>
                <span class="telemetry-safe">${safeRangeStr}</span>
            </div>

            <div class="ring-card-footer">
                <a href="${routeUrl}" class="af-route-link" data-alert-id="${alert.id}" data-param="${alert.parameter}">
                    Assign Action <span class="route-arrow">&rarr;</span>
                </a>
                <span class="ring-timestamp">
                    <i class="fa-regular fa-clock"></i> ${timeAgo}
                </span>
            </div>
        </div>
    </div>`;
}

/**
 * Renders the Progress Overview Header and groups alerts into the CSS Grid .alert-deck.
 */
function renderGroups(container, alerts) {
    const seen = getSeenKeys();
    const metrics = computeOverviewMetrics(alerts);

    // 1. Progress Overview Header Grid
    const overviewHtml = `
    <div class="alert-overview-grid" aria-label="Alerts Progress Overview">
        ${renderOverviewCard({
            title: 'Critical Alerts Resolved',
            resolved: metrics.critical.resolved,
            total: metrics.critical.total,
            pct: metrics.critical.pct,
            strokeClass: 'stroke-critical',
            countVerb: 'resolved',
            subtext: metrics.critical.total - metrics.critical.resolved === 0
                ? 'All critical issues addressed'
                : `${metrics.critical.total - metrics.critical.resolved} urgent action${metrics.critical.total - metrics.critical.resolved === 1 ? '' : 's'} remaining`
        })}
        ${renderOverviewCard({
            title: 'Warning Alerts Handled',
            resolved: metrics.warning.resolved,
            total: metrics.warning.total,
            pct: metrics.warning.pct,
            strokeClass: 'stroke-warning',
            countVerb: 'handled',
            subtext: metrics.warning.total - metrics.warning.resolved === 0
                ? 'All warnings under control'
                : `${metrics.warning.total - metrics.warning.resolved} parameter${metrics.warning.total - metrics.warning.resolved === 1 ? '' : 's'} to monitor`
        })}
        ${renderOverviewCard({
            title: 'Overall Action Health',
            resolved: metrics.total.resolved,
            total: metrics.total.total,
            pct: metrics.total.pct,
            strokeClass: 'stroke-total',
            countVerb: 'completed',
            subtext: metrics.total.total - metrics.total.resolved === 0
                ? 'Optimal closed-loop operation'
                : `${metrics.total.total - metrics.total.resolved} total action${metrics.total.total - metrics.total.resolved === 1 ? '' : 's'} pending`
        })}
    </div>`;

    // 2. Alert Groups (Categorized Feed)
    const groups = groupByType(alerts);
    const orderedTypes = Object.keys(TYPE_GROUPS).sort((a, b) => TYPE_GROUPS[a].order - TYPE_GROUPS[b].order);

    const sections = orderedTypes
        .filter((type) => groups[type] && groups[type].length)
        .map((type) => `
        <section class="alert-group alert-group--${type}">
            <div class="alert-group-header">
                <span class="alert-group-title">${TYPE_GROUPS[type].label}</span>
                <span class="alert-group-count">${groups[type].length}</span>
            </div>
            <div class="alert-deck">
                ${groups[type].map((alert) => renderFeedCard(alert, seen)).join('')}
            </div>
        </section>`);

    container.innerHTML = overviewHtml + (sections.length
        ? sections.join('')
        : '<div class="alerts-empty-state">No active alerts. Every parameter is within its safe range.</div>');

    // Per-card seen marking: updates topbar badge and re-renders live progress gauges
    container.querySelectorAll('.alert-ring-card.unseen[data-alert-id]').forEach((card) => {
        card.addEventListener('click', () => {
            markSeen([`alert:${card.getAttribute('data-alert-id')}`]);
            card.classList.remove('unseen');
            updateBadge(document.querySelector('.notification-badge'), computeUnseenCount(alerts));
            renderGroups(container, alerts);
        });
    });

    // "Assign Action": stash the alert context for assign-actions.html, then let
    // the anchor navigate. sessionStorage covers dev servers whose clean-URL
    // redirect strips the query string; the href keeps the query too.
    container.querySelectorAll('.af-route-link[data-alert-id]').forEach((link) => {
        link.addEventListener('click', (e) => {
            // Don't bubble to the card seen-handler above — it re-renders the deck
            // and would yank this <a> out of the DOM mid-navigation.
            e.stopPropagation();
            const alertId = link.dataset.alertId;
            try {
                sessionStorage.setItem('pendingAlertCtx', JSON.stringify({
                    alertId,
                    param: link.dataset.param || ''
                }));
            } catch (_) { /* storage disabled — the href query string is the fallback */ }
            markSeen([`alert:${alertId}`]);   // parity with the old bubble-to-card behavior
            // no preventDefault — the anchor navigates on its own
        });
    });
}

async function init() {
    const container = document.getElementById('alerts-groups');
    if (!container) return;

    let alerts = [];
    try {
        alerts = await fetchActiveAlerts();
    } catch (err) {
        console.warn('Unable to load active alerts.', err);
    }

    // Paint 1: cards render immediately with a "loading trend" placeholder.
    renderGroups(container, alerts);

    // Paint 2: swap in sparklines once the cached readings resolve. The fetch
    // never blocks the page; on failure the placeholder becomes "no trend data".
    try {
        readingsByParam = await loadReadingsIndex();
    } catch (err) {
        console.warn('All Alerts: reading history unavailable for sparklines.', err);
        readingsByParam = {};
    }
    renderGroups(container, alerts);
}

init();

// ── Sidebar: mobile open/close ───────────────────────────────────────────────
(function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('topbarMenuBtn');
    if (sidebar && overlay && menuBtn) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('show');
            overlay.setAttribute('aria-hidden', 'false');
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            overlay.setAttribute('aria-hidden', 'true');
        });
    }
})();

// ── Sidebar collapse/toggle, persistence and click-to-collapse ───────────────
initSidebar();
