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
    var survivalChartInstance = null;
    var ctx = document.getElementById('survivalChart');
    if (ctx) {
        survivalChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'],
                datasets: [
                    {
                        label: 'Actual Survival %',
                        data: [78, 82, 86, 90, null, null, null, null],
                        borderColor: '#059669',
                        backgroundColor: 'rgba(5, 150, 105, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: '#059669',
                        pointRadius: 4
                    },
                    {
                        label: 'Predicted Survival %',
                        data: [null, null, null, 90, 92, 94, 96, 98],
                        borderColor: '#9ca3af',
                        borderDash: [6, 4],
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: '#9ca3af',
                        pointRadius: 4,
                        pointStyle: 'circle'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        min: 60,
                        max: 100,
                        ticks: { stepSize: 10 },
                        grid: { color: '#f3f4f6' }
                    },
                    x: {
                        grid: { display: false }
                    }
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
