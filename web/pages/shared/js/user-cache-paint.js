// Pre-paint: read the cached user profile (written by userProfile.js on every
// successful load) and fill the sidebar-footer + topbar name / role / avatar so
// the real values render in the first frame instead of the hardcoded "A" /
// "Admin" / "T" placeholders. Plain script, no imports, loaded parser-blocking
// right after the topbar so both the sidebar footer and topbar are in the DOM.
(function () {
    try {
        var c = JSON.parse(localStorage.getItem('bantay-ulang-user-cache'));
        if (!c) return;
        if (c.fullName) {
            document.querySelectorAll('.user-name, .admin-name, .pm-name').forEach(function (el) {
                el.textContent = c.fullName;
            });
        }
        if (c.role) {
            document.querySelectorAll('.user-role, .admin-role, .pm-role').forEach(function (el) {
                el.textContent = c.role;
            });
        }
        if (c.initial) {
            document.querySelectorAll('.user-avatar > span, .admin-avatar > span, .pm-avatar > span').forEach(function (el) {
                el.textContent = c.initial;
            });
        }
    } catch (e) { /* corrupt JSON / storage blocked - leave placeholders */ }
})();
