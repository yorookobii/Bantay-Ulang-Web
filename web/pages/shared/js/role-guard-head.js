// Pre-paint role check: redirect only when the cached session role is known and wrong for <html data-role>; roleGuard.js makes the real check.
(function () {
    var HOME = { admin: '../shared/dashboard.html', technician: '../technician/dashboard-technician.html' };
    try {
        var need = document.documentElement.getAttribute('data-role');
        var raw = localStorage.getItem('bantay-ulang-auth-user') || sessionStorage.getItem('bantay-ulang-auth-user');
        var role = raw ? String(JSON.parse(raw).role || '').toLowerCase() : '';
        if (need && HOME[role] && role !== need) window.location.replace(HOME[role]);
    } catch (e) { /* corrupt JSON / storage blocked - let roleGuard.js decide */ }
})();
