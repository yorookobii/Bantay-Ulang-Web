(function() {
    function init() {
        var container = document.querySelector('.topbar');
        if (!container) return;
        var notifDropdown = container.querySelector('.notification-dropdown');
        var profileDropdown = container.querySelector('.profile-dropdown');
        var notifBtn = container.querySelector('.notification-icon');
        var profileBtn = container.querySelector('.admin-profile');
        if (notifBtn && notifDropdown) {
            notifBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                notifDropdown.classList.toggle('show');
                if (profileDropdown) profileDropdown.classList.remove('show');
            });
        }
        if (profileBtn && profileDropdown) {
            profileBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                profileDropdown.classList.toggle('show');
                if (notifDropdown) notifDropdown.classList.remove('show');
            });
        }
        document.addEventListener('click', function(e) {
            if (container.contains(e.target)) return;
            if (notifDropdown) notifDropdown.classList.remove('show');
            if (profileDropdown) profileDropdown.classList.remove('show');
        });
        var menuItems = container.querySelectorAll('.profile-menu-item');
        menuItems.forEach(function(item) {
            if (item.textContent.indexOf('Logout') !== -1) {
                item.addEventListener('click', function() { alert('Logging out...'); });
            }
        });

        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        var menuBtn = document.getElementById('topbarMenuBtn');
        var app = document.querySelector('.app');
        if (sidebar && overlay && menuBtn) {
            menuBtn.addEventListener('click', function() {
                sidebar.classList.add('open');
                overlay.classList.add('show');
                overlay.setAttribute('aria-hidden', 'false');
            });
            overlay.addEventListener('click', function() {
                sidebar.classList.remove('open');
                overlay.classList.remove('show');
                overlay.setAttribute('aria-hidden', 'true');
            });
        }

        /* Sidebar toggle: collapse on desktop, close drawer on mobile */
        var sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        if (sidebar && app && sidebarToggleBtn) {
            function isMobile() { return window.innerWidth <= 768; }
            function setCollapsed(collapsed) {
                if (collapsed) {
                    sidebar.classList.add('collapsed');
                    app.classList.add('sidebar-collapsed');
                } else {
                    sidebar.classList.remove('collapsed');
                    app.classList.remove('sidebar-collapsed');
                }
                try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
            }
            sidebarToggleBtn.addEventListener('click', function() {
                if (isMobile()) {
                    sidebar.classList.remove('open');
                    if (overlay) {
                        overlay.classList.remove('show');
                        overlay.setAttribute('aria-hidden', 'true');
                    }
                } else {
                    var collapsed = !sidebar.classList.contains('collapsed');
                    setCollapsed(collapsed);
                    sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
                }
            });
            if (!isMobile()) {
                try {
                    if (localStorage.getItem('sidebar-collapsed') === '1') {
                        setCollapsed(true);
                        sidebarToggleBtn.setAttribute('aria-label', 'Expand sidebar');
                    }
                } catch (e) {}
            }
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
document.addEventListener('DOMContentLoaded', function() {
    // ── Sample/placeholder charts — static hardcoded data, never randomized ──

    var avgWeightCtx = document.getElementById('avgWeightChart');
    if (avgWeightCtx) {
        new Chart(avgWeightCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'],
                datasets: [{
                    label: 'Avg Weight (g)',
                    data: [2, 3.5, 5, 7, 9, 12, 15, 18],
                    borderColor: '#0d9488',
                    backgroundColor: 'rgba(13, 148, 136, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#0d9488',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Avg Weight (g)' },
                        grid: { color: '#f3f4f6' }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    var wqsTrendCtx = document.getElementById('wqsTrendChart');
    if (wqsTrendCtx) {
        new Chart(wqsTrendCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'],
                datasets: [{
                    label: 'Water Quality Score (%)',
                    data: [78, 85, 82, 90, 76, 88, 84, 91],
                    borderColor: '#1d4ed8',
                    backgroundColor: 'rgba(29, 78, 216, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#1d4ed8',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 20 },
                        title: { display: true, text: 'WQS (%)' },
                        grid: { color: '#f3f4f6' }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

});

// ── Efficiency circle: driven by yield-prediction-updated event ───────────
// yieldPrediction.js dispatches this after it computes the WQ score from
// the latest sensor reading, so we reuse its result without a second fetch.
document.addEventListener('yield-prediction-updated', function (e) {
    var wqScore = e.detail && e.detail.wqScore;
    if (!wqScore) return;

    var pct    = Math.round(wqScore * 100);
    var deg    = ((pct / 100) * 360).toFixed(1);
    var color  = pct >= 85 ? '#10b981' : pct >= 70 ? '#d97706' : '#ef4444';
    var status = pct >= 85 ? 'OPTIMAL' : pct >= 70 ? 'GOOD' : pct >= 60 ? 'FAIR' : 'POOR';

    var outer = document.getElementById('eff-circle-outer');
    if (outer) {
        outer.style.background =
            'conic-gradient(' + color + ' 0deg ' + deg + 'deg, #e5e7eb ' + deg + 'deg 360deg)';
    }

    var effVal = document.getElementById('eff-value');
    if (effVal) effVal.textContent = pct + '%';

    var effStatus = document.getElementById('eff-status');
    if (effStatus) effStatus.textContent = status;

    var effDesc = document.getElementById('eff-desc');
    if (effDesc) {
        var note = pct >= 85
            ? 'System is operating at <strong>peak efficiency</strong> for ulang cultivation.'
            : pct >= 70
            ? 'System is performing <strong>adequately</strong> — address sensor alerts to improve.'
            : 'System needs <strong>immediate attention</strong> — multiple parameters out of range.';
        effDesc.innerHTML = 'Water Quality Score: ' + wqScore.toFixed(2) + ' (' + pct + '%). ' + note;
    }
});
