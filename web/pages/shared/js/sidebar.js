// Shared sidebar behavior: collapse persistence, click-to-collapse, click-to-expand rail.
// Call initSidebar() once per page. The .collapsed (#sidebar) / .sidebar-collapsed
// (.app) classes and the 72px rail live in the page CSS; this only toggles them.
// #sidebarToggleBtn is the mobile drawer's close button (hidden on desktop).

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

    const sidebar  = document.getElementById('sidebar');
    const app      = document.querySelector('.app');
    const header   = sidebar?.querySelector('.sidebar-header');
    const closeBtn = document.getElementById('sidebarToggleBtn');
    const menuBtn  = document.getElementById('topbarMenuBtn');
    const overlay  = document.getElementById('sidebarOverlay');
    const content  = document.querySelector('.content') || document.querySelector('main');
    if (!sidebar || !app) { done(); return; }
    wired = true;

    try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}

    // The header is the collapsed rail's keyboard control; it is a plain header when expanded.
    const setHeaderControl = (collapsed) => {
        if (!header) return;
        if (collapsed) {
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            header.setAttribute('aria-expanded', 'false');
            header.setAttribute('aria-label', 'Expand sidebar');
        } else {
            ['role', 'tabindex', 'aria-expanded', 'aria-label'].forEach(a => header.removeAttribute(a));
        }
    };

    const setCollapsed = (v) => {
        sidebar.classList.toggle('collapsed', v);
        app.classList.toggle('sidebar-collapsed', v);
        setHeaderControl(v);
        try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (_) {}
    };

    const isRail = () => !isMobile() && sidebar.classList.contains('collapsed');

    // Bare click in the content area collapses an expanded rail (desktop only).
    content?.addEventListener('click', (e) => {
        if (isMobile()) return;
        if (sidebar.classList.contains('collapsed')) return;
        if (e.target.closest(NO_COLLAPSE)) return;
        if (window.getSelection && String(window.getSelection()).length) return; // mid text-selection
        setCollapsed(true);
    });

    // Click anywhere on the collapsed rail expands it; links and buttons keep their own action.
    sidebar.addEventListener('click', (e) => {
        if (!isRail() || e.target.closest('a, button')) return;
        setCollapsed(false);
    });

    // Enter/Space on the focused header expands the rail, then focus moves into the menu.
    header?.addEventListener('keydown', (e) => {
        if (!isRail() || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        setCollapsed(false);
        (sidebar.querySelector('.sidebar-menu a.active') || sidebar.querySelector('.sidebar-menu a'))?.focus();
    });

    // Mobile drawer: the close button and Esc close it and return focus to the hamburger.
    const closeDrawer = () => {
        sidebar.classList.remove('open');
        overlay?.classList.remove('show');
        overlay?.setAttribute('aria-hidden', 'true');
        menuBtn?.focus();
    };
    closeBtn?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) closeDrawer();
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
