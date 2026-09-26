// Shared sidebar behavior: arrow toggle, collapse persistence, click-to-collapse.
// Call initSidebar() once per page. The .collapsed (#sidebar) / .sidebar-collapsed
// (.app) classes and the 72px rail live in the page CSS; this only toggles them.

const STORAGE_KEY = 'sidebar-collapsed';
const LEGACY_KEY  = 'dashboard-sidebar-collapsed';   // pre-unification key, now dead
const MOBILE_MAX  = 768;
const isMobile = () => window.innerWidth <= MOBILE_MAX;

// A click inside .content that lands on one of these (or a descendant) never
// collapses the rail: interactive controls, chart/vector surfaces, dropdowns.
const NO_COLLAPSE = [
    'a', 'button', 'input', 'select', 'textarea', 'label',
    '[role="button"]', '[contenteditable]', 'canvas', 'svg',
    '.dropdown', '.notification-dropdown',
    '[data-no-collapse]'
].join(',');

let wired = false;

export function initSidebar() {
    if (wired) return;                       // ignore accidental double-calls
    // Hand off from the pre-paint head-script class; also re-enables transitions.
    const done = () => document.documentElement.classList.remove('sidebar-init-collapsed');

    const sidebar = document.getElementById('sidebar');
    const app     = document.querySelector('.app');
    const btn     = document.getElementById('sidebarToggleBtn');
    const overlay = document.getElementById('sidebarOverlay');
    const content = document.querySelector('.content') || document.querySelector('main');
    if (!sidebar || !app || !btn) { done(); return; }
    wired = true;

    try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}

    const setCollapsed = (v) => {
        sidebar.classList.toggle('collapsed', v);
        app.classList.toggle('sidebar-collapsed', v);
        btn.setAttribute('aria-label', v ? 'Expand sidebar' : 'Collapse sidebar');
        try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (_) {}
    };

    // Arrow button: collapse/expand on desktop, close the drawer on mobile.
    btn.addEventListener('click', () => {
        if (isMobile()) {
            sidebar.classList.remove('open');
            overlay?.classList.remove('show');
            overlay?.setAttribute('aria-hidden', 'true');
        } else {
            setCollapsed(!sidebar.classList.contains('collapsed'));
        }
    });

    // Bare click in the content area collapses an expanded rail (desktop only).
    content?.addEventListener('click', (e) => {
        if (isMobile()) return;
        if (sidebar.classList.contains('collapsed')) return;
        if (e.target.closest(NO_COLLAPSE)) return;
        if (window.getSelection && String(window.getSelection()).length) return; // mid text-selection
        setCollapsed(true);
    });

    // Restore persisted state on load (desktop only — matches prior behavior).
    if (!isMobile()) {
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true);
        } catch (_) {}
    }

    // Commit the collapsed geometry (still transition-suppressed by the head-script
    // class) with a forced reflow, THEN lift the class so transitions re-enable
    // with nothing left to animate.
    void document.documentElement.offsetHeight;
    done();
}
