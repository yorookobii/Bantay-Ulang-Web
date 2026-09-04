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

// Ordered so a future 'task_completed' type is a one-line addition here —
// no change needed to groupByType()/renderGroups() below. When it lands,
// the data source becomes a union of fetchActiveAlerts() + a tasks query
// normalized to {id, type: 'task_completed', ...} before grouping.
const TYPE_GROUPS = {
    critical_out_of_range: { label: 'Critical', order: 0 },
    out_of_range:          { label: 'Out of Range', order: 1 }
    // task_completed:     { label: 'Completed Tasks', order: 2 }
};

function groupByType(alerts) {
    const groups = {};
    alerts.forEach((alert) => {
        const key = TYPE_GROUPS[alert.type] ? alert.type : 'out_of_range';
        (groups[key] = groups[key] || []).push(alert);
    });
    return groups;
}

function renderRow(alert, seen) {
    const { icon, color } = SEVERITY_ICON[alert.severity] || SEVERITY_ICON.low;
    const time = formatRelativeTime(alert.createdAt?.toDate?.());
    const isUnseen = !seen.has(`alert:${alert.id}`);
    const paramLabel = PARAM_LABELS[alert.parameter] || alert.parameter || 'Parameter';
    return `<li class="alert-row${isUnseen ? ' unseen' : ''}" data-alert-id="${alert.id}">
        <i class="${icon} alert-row-icon" style="color:${color}"></i>
        <div class="alert-row-body">
            <div class="alert-row-top">
                <span class="alert-row-param">${paramLabel}</span>
                <span class="alert-row-sep">&middot;</span>
                <span class="alert-row-value">Current: ${alert.currentValue ?? '—'}</span>
                <span class="alert-row-sep">&middot;</span>
                <span class="alert-row-value">Safe range: ${alert.safeRange || '—'}</span>
            </div>
            <p class="alert-row-message">${alert.message || ''}</p>
        </div>
        <span class="alert-row-time">${time}</span>
    </li>`;
}

function renderGroups(container, alerts) {
    const seen = getSeenKeys();
    const groups = groupByType(alerts);
    const orderedTypes = Object.keys(TYPE_GROUPS).sort((a, b) => TYPE_GROUPS[a].order - TYPE_GROUPS[b].order);

    const sections = orderedTypes
        .filter((type) => groups[type] && groups[type].length)
        .map((type) => `<section class="alert-group alert-group--${type}">
            <div class="alert-group-header">
                <span class="alert-group-title">${TYPE_GROUPS[type].label}</span>
                <span class="alert-group-count">${groups[type].length}</span>
            </div>
            <ul class="alert-row-list">
                ${groups[type].map((alert) => renderRow(alert, seen)).join('')}
            </ul>
        </section>`);

    container.innerHTML = sections.length
        ? sections.join('')
        : '<div class="alerts-empty-state">No active alerts. Every parameter is within its safe range.</div>';

    // Per-row seen marking: stays on the page, updates this page's own
    // topbar badge live. Does not navigate (unlike the bell's behavior).
    container.querySelectorAll('.alert-row.unseen[data-alert-id]').forEach((row) => {
        row.addEventListener('click', () => {
            markSeen([`alert:${row.getAttribute('data-alert-id')}`]);
            row.classList.remove('unseen');
            updateBadge(document.querySelector('.notification-badge'), computeUnseenCount(alerts));
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

// ── Sidebar: collapse/expand on desktop ──────────────────────────────────────
(function () {
    const sidebar       = document.getElementById('sidebar');
    const app           = document.querySelector('.app');
    const sidebarToggle = document.getElementById('sidebarToggleBtn');
    const overlay       = document.getElementById('sidebarOverlay');

    if (!sidebar || !app || !sidebarToggle) return;

    function isMobile() { return window.innerWidth <= 768; }

    function setCollapsed(collapsed) {
        sidebar.classList.toggle('collapsed', collapsed);
        app.classList.toggle('sidebar-collapsed', collapsed);
        try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); } catch (_) {}
    }

    sidebarToggle.addEventListener('click', () => {
        if (isMobile()) {
            sidebar.classList.remove('open');
            if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
        } else {
            const collapsed = !sidebar.classList.contains('collapsed');
            setCollapsed(collapsed);
            sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        }
    });

    if (!isMobile()) {
        try {
            if (localStorage.getItem('sidebar-collapsed') === '1') {
                setCollapsed(true);
                sidebarToggle.setAttribute('aria-label', 'Expand sidebar');
            }
        } catch (_) {}
    }
})();
