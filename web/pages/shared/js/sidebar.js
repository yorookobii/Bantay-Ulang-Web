// Shared sidebar behavior: the desktop sidebar is always expanded; on mobile the
// drawer closes from its close button (#sidebarToggleBtn) or Esc. Call initSidebar() once per page.

const RETIRED_KEYS = ['sidebar-collapsed', 'dashboard-sidebar-collapsed'];   // old collapse state

let wired = false;

export function initSidebar() {
    if (wired) return;                       // ignore accidental double-calls
    wired = true;

    // Clear any saved collapse state so nobody stays stuck on a collapsed rail.
    try { RETIRED_KEYS.forEach(key => localStorage.removeItem(key)); } catch (_) {}

    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebarOverlay');
    const closeBtn = document.getElementById('sidebarToggleBtn');
    const menuBtn  = document.getElementById('topbarMenuBtn');
    if (!sidebar) return;

    // Closes the drawer and hands focus back to the hamburger that opened it.
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
}
