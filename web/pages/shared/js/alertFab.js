import { subscribe, countAlerts } from './alertState.js';
import { groupAlerts } from './reportCleanup.js';
import { PARAM_LABELS } from './notificationsShared.js';

// Floating alert indicator (bottom-right) fed only by alertState; no reads or writes of its own.

const SEEN_KEY = 'bantay-ulang-fab-seen';
const PULSED_KEY = 'bantay-ulang-fab-pulsed';
const MIN_KEY = 'bantay-ulang-fab-minimized';
const PANEL_LIMIT = 5;
const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITY_WORD = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const STATES = {
    offline:  { word: 'Sensor offline', icon: 'fa-plug' },
    critical: { word: 'Critical',       icon: 'fa-triangle-exclamation' },
    warning:  { word: 'Warning',        icon: 'fa-circle-exclamation' },
    watch:    { word: 'Watch',          icon: 'fa-circle-info' },
    clear:    { word: 'Clear',          icon: 'fa-circle-check' }
};

function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}

function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const counted = (alerts) => alerts.filter((a) => a.excludeFromReports !== true);

// New = never seen, or escalated to critical since it was last seen.
const isNew = (alert, seen) => !(alert.id in seen) || (alert.severity === 'critical' && seen[alert.id] !== 'critical');

/** Button state, counts and the new/ongoing split for one alert list. */
export function summarize(alerts, seen) {
    const list = counted(alerts);
    const { active, handled } = countAlerts(alerts);
    const top = list.reduce((max, a) => Math.max(max, RANK[a.severity] || 0), 0);
    const state = list.some((a) => a.type === 'hardware_offline') ? 'offline'
        : top === 4 ? 'critical' : top >= 2 ? 'warning' : active ? 'watch' : 'clear';
    const fresh = list.filter((a) => isNew(a, seen));
    return {
        state, active, handled,
        critical: list.filter((a) => a.severity === 'critical').length,
        fresh: fresh.length,
        newCriticalIds: fresh.filter((a) => a.severity === 'critical').map((a) => a.id)
    };
}

/** Screen reader label, e.g. "3 active alerts, 1 critical, 1 being handled". */
export function ariaLabel(s) {
    if (!s.active) return 'No active alerts. Open alert summary';
    const parts = [plural(s.active, 'active alert')];
    if (s.critical) parts.push(`${s.critical} critical`);
    if (s.handled) parts.push(`${s.handled} being handled`);
    if (s.fresh) parts.push(`${s.fresh} new`);
    return `${s.state === 'offline' ? 'Sensor offline. ' : ''}${parts.join(', ')}. Open alert summary`;
}

/** Grouped panel rows: hardware first, then worst severity, unhandled before handled, newest. */
export function panelGroups(alerts) {
    const rows = counted(alerts).map((a) => ({ ...a, createdAtMs: a.createdAt?.toMillis?.() ?? null, handled: a.handledAt != null }));
    return groupAlerts(rows).sort((a, b) =>
        (b.type === 'hardware_offline') - (a.type === 'hardware_offline')
        || (RANK[b.severity] || 0) - (RANK[a.severity] || 0)
        || a.handled - b.handled
        || (b.lastMs ?? 0) - (a.lastMs ?? 0));
}

export function ongoingFor(sinceMs, now = Date.now()) {
    if (sinceMs == null) return '';
    const mins = Math.max(1, Math.floor((now - sinceMs) / 60000));
    if (mins < 60) return `ongoing for ${mins}m`;
    if (mins < 1440) return `ongoing for ${Math.floor(mins / 60)}h`;
    return `ongoing for ${Math.floor(mins / 1440)}d`;
}

function formatValue(group) {
    if (group.type === 'hardware_offline') return 'No sensor data';
    const v = group.lastValue;
    if (typeof v === 'boolean') return v ? 'Safe' : 'Unsafe';
    if (v == null || v === '') return '';
    const text = Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 100) / 100) : String(v);
    return group.valueSuspect ? `Now ${text} (value looks faulty)` : `Now ${text}`;
}

function itemHtml(group, links) {
    const sev = group.severity || 'low';
    const label = group.type === 'hardware_offline' ? 'Sensor offline' : (PARAM_LABELS[group.parameter] || group.parameter || 'Alert');
    const v = group.lastValue;
    const numeric = v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
    const meta = [formatValue(group), numeric && group.safeRange ? `safe ${group.safeRange}` : '', ongoingFor(group.firstMs)]
        .filter(Boolean).join(' · ');
    const alertId = group.alertIds[group.alertIds.length - 1];
    const assign = links.assign && !group.handled
        ? `<a class="af-assign" role="menuitem" tabindex="-1" href="${links.assign(alertId, group.parameter)}">
               <i class="fa-solid fa-user-plus" aria-hidden="true"></i><span>Assign task<span class="af-sr"> for ${escapeHtml(label)}</span></span></a>`
        : '';
    return `<li class="af-row">
        <a class="af-item" role="menuitem" tabindex="-1" href="${links.viewAll}" data-sev="${sev}">
            <i class="fa-solid ${group.type === 'hardware_offline' ? 'fa-plug' : sev === 'critical' ? 'fa-triangle-exclamation' : sev === 'low' ? 'fa-circle-info' : 'fa-circle-exclamation'} af-item-icon" aria-hidden="true"></i>
            <span class="af-item-body">
                <span class="af-item-top"><span class="af-item-label">${escapeHtml(label)}</span>
                    <span class="af-sev">${SEVERITY_WORD[sev] || sev}</span>
                    ${group.handled ? '<span class="af-handled"><i class="fa-solid fa-user-check" aria-hidden="true"></i>Being handled</span>' : ''}</span>
                <span class="af-item-meta">${escapeHtml(meta)}</span>
            </span>
        </a>${assign}
    </li>`;
}

/** Mounts the indicator once per page; technician pages get their own links and no Assign task. */
export function initAlertFab({ technician = false } = {}) {
    if (!document.body || document.getElementById('alertFab')) return;
    const links = technician
        ? { viewAll: 'dashboard-technician.html#alerts', tasks: 'task-technician.html', assign: null }
        : { viewAll: 'all-alerts.html', tasks: null,
            assign: (id, param) => `assign-actions.html?alert_id=${encodeURIComponent(id)}&param=${encodeURIComponent(param || '')}` };

    const root = document.createElement('div');
    root.className = 'af-root';
    root.id = 'alertFab';
    root.hidden = true;
    root.innerHTML = `
        <div class="af-panel" id="afPanel">
            <div class="af-head"><span class="af-title">Active alerts</span><span class="af-sub"></span></div>
            <div class="af-menu" role="menu" aria-label="Active alerts"><ul class="af-list"></ul>
                <div class="af-foot">
                    <a class="af-link" role="menuitem" tabindex="-1" href="${links.viewAll}"><i class="fa-solid fa-list" aria-hidden="true"></i><span>View all alerts</span></a>
                    ${links.tasks ? `<a class="af-link" role="menuitem" tabindex="-1" href="${links.tasks}"><i class="fa-solid fa-clipboard-list" aria-hidden="true"></i><span>My tasks</span></a>` : ''}
                    <button type="button" class="af-link af-minimize" role="menuitem" tabindex="-1"><i class="fa-solid fa-minus" aria-hidden="true"></i><span>Minimize</span></button>
                </div>
            </div>
        </div>
        <button type="button" class="af-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="afPanel">
            <i class="fa-solid af-icon" aria-hidden="true"></i><span class="af-word"></span><span class="af-count"></span><span class="af-tag"></span>
        </button>
        <button type="button" class="af-tab"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span class="af-dot" aria-hidden="true"></span></button>`;
    document.body.appendChild(root);

    // Styles ship beside this module so pages need no extra <link>; show once loaded (or failed).
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('../css/alertFab.css', import.meta.url).href;
    css.onload = css.onerror = () => { root.hidden = false; };
    document.head.appendChild(css);

    const btn = root.querySelector('.af-btn');
    const tab = root.querySelector('.af-tab');
    const panel = root.querySelector('.af-panel');
    const list = root.querySelector('.af-list');
    let alerts = [];
    let summary = summarize([], {});

    const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
    const items = () => [...root.querySelectorAll('.af-menu [role="menuitem"]')];

    function render() {
        summary = summarize(alerts, readJson(SEEN_KEY, {}));
        const { state, active, handled, fresh, newCriticalIds } = summary;
        root.dataset.state = state;
        root.dataset.mode = state === 'clear' ? 'clear' : fresh ? 'new' : 'ongoing';
        root.toggleAttribute('data-alarm', newCriticalIds.length > 0);
        root.querySelector('.af-icon').className = `fa-solid ${STATES[state].icon} af-icon`;
        root.querySelector('.af-word').textContent = STATES[state].word;
        root.querySelector('.af-count').textContent = active ? String(active) : '';
        root.querySelector('.af-tag').textContent = !active ? '' : fresh ? 'new' : 'ongoing';
        btn.setAttribute('aria-label', ariaLabel(summary));
        tab.setAttribute('aria-label', `Show alert indicator${newCriticalIds.length ? `, ${plural(newCriticalIds.length, 'new critical alert')}` : ''}`);
        root.querySelector('.af-sub').textContent = active ? `${active} active${handled ? ` · ${handled} being handled` : ''}` : 'No active alerts';

        // Pulse once per new critical alert; reduced motion shows the static data-alarm ring instead.
        const pulsed = new Set(readJson(PULSED_KEY, []));
        const unpulsed = newCriticalIds.filter((id) => !pulsed.has(id));
        if (unpulsed.length) {
            root.removeAttribute('data-pulse');
            void btn.offsetWidth;
            root.setAttribute('data-pulse', '');
            writeJson(PULSED_KEY, newCriticalIds);
        }
        // A live refresh while open keeps keyboard focus on the same position.
        if (isOpen()) {
            const at = items().indexOf(document.activeElement);
            renderList();
            if (at >= 0) { const all = items(); all[Math.min(at, all.length - 1)]?.focus(); }
        }
    }

    function renderList() {
        const groups = panelGroups(alerts).slice(0, PANEL_LIMIT);
        list.innerHTML = groups.length
            ? groups.map((g) => itemHtml(g, links)).join('')
            : '<li class="af-empty"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> All parameters are within safe range</li>';
    }

    function markSeen() {
        const seen = {};
        counted(alerts).forEach((a) => { seen[a.id] = a.severity; });
        writeJson(SEEN_KEY, seen);
    }

    function closeOthers() {
        document.getElementById('notificationDropdown')?.classList.remove('show');
        const pm = document.querySelector('.pm-trigger[aria-expanded="true"]');
        if (pm) {
            pm.setAttribute('aria-expanded', 'false');
            document.getElementById('pmMenu')?.removeAttribute('data-open');
        }
    }

    function open(focusIndex = 0) {
        closeOthers();
        btn.setAttribute('aria-expanded', 'true');
        panel.setAttribute('data-open', '');
        markSeen();
        render();
        const all = items();
        all[(focusIndex + all.length) % all.length]?.focus();
    }

    function close(returnFocus) {
        if (!isOpen()) return;
        btn.setAttribute('aria-expanded', 'false');
        panel.removeAttribute('data-open');
        if (returnFocus) btn.focus();
    }

    function setMinimized(min) {
        close(false);
        root.toggleAttribute('data-min', min);
        writeJson(MIN_KEY, min);
        (min ? tab : btn).focus();
    }

    btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(0); }
        if (e.key === 'ArrowUp') { e.preventDefault(); open(-1); }
    });
    tab.addEventListener('click', () => setMinimized(false));
    root.querySelector('.af-minimize').addEventListener('click', () => setMinimized(true));

    root.querySelector('.af-menu').addEventListener('keydown', (e) => {
        const all = items();
        const i = all.indexOf(document.activeElement);
        const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 };
        if (e.key in moves) {
            e.preventDefault();
            all[(moves[e.key] + all.length) % all.length].focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close(true);
        } else if (e.key === 'Tab') {
            close(false);
        }
    });

    // Capture phase so handlers that stopPropagation (the bell) still close the panel.
    document.addEventListener('click', (e) => {
        if (!isOpen() || root.contains(e.target)) return;
        close(!e.target.closest?.('a, button, input, select, textarea, [tabindex]'));
    }, true);

    // The bell or profile menu opening by any route (click or keyboard) closes the panel.
    const bellDropdown = document.getElementById('notificationDropdown');
    const pmTrigger = document.querySelector('.pm-trigger');
    const watch = new MutationObserver(() => {
        if (bellDropdown?.classList.contains('show') || pmTrigger?.getAttribute('aria-expanded') === 'true') close(false);
    });
    if (bellDropdown) watch.observe(bellDropdown, { attributes: true, attributeFilter: ['class'] });
    if (pmTrigger) watch.observe(pmTrigger, { attributes: true, attributeFilter: ['aria-expanded'] });

    root.toggleAttribute('data-min', readJson(MIN_KEY, false) === true);
    render();
    subscribe((next) => { alerts = next; render(); });
}
