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

    function rand(min, max, decimals) {
        var d = decimals || 0;
        var v = min + Math.random() * (max - min);
        return d === 0 ? Math.round(v) : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    }

    function runNewSimulation() {
        if (survivalChartInstance && survivalChartInstance.data && survivalChartInstance.data.datasets) {
            var actualStart = rand(76, 82, 0);
            var actualEnd = rand(88, 94, 0);
            var step = (actualEnd - actualStart) / 3;
            var actualData = [
                actualStart,
                Math.round(actualStart + step),
                Math.round(actualStart + step * 2),
                actualEnd,
                null, null, null, null
            ];
            var predStart = actualEnd;
            var predEnd = Math.min(100, predStart + rand(4, 10, 0));
            var predStep = (predEnd - predStart) / 4;
            var predData = [null, null, null, predStart,
                Math.round((predStart + predStep) * 10) / 10,
                Math.round((predStart + predStep * 2) * 10) / 10,
                Math.round((predStart + predStep * 3) * 10) / 10,
                predEnd
            ];
            survivalChartInstance.data.datasets[0].data = actualData;
            survivalChartInstance.data.datasets[1].data = predData;
            survivalChartInstance.update();
        }

        var paramRows = document.querySelectorAll('.analytics-card .param-row');
        var paramConfigs = [
            { name: 'pH', value: rand(6.8, 7.6, 1), unit: '', pct: rand(85, 98, 0) },
            { name: 'Temp', value: rand(26, 30, 1), unit: '°C', pct: rand(72, 92, 0) },
            { name: 'DO', value: rand(5.8, 7.2, 1), unit: '', pct: rand(62, 88, 0) },
            { name: 'Salinity', value: rand(13, 17, 0), unit: ' ppt', pct: rand(82, 96, 0) },
            { name: 'Turbidity', value: rand(2.5, 4.5, 1), unit: ' NTU', pct: rand(78, 92, 0) },
            { name: 'Nitrate', value: rand(3, 8, 0), unit: ' ppm', pct: rand(80, 95, 0) }
        ];
        paramRows.forEach(function(row, i) {
            var cfg = paramConfigs[i];
            if (!cfg) return;
            var labelEl = row.querySelector('.param-label');
            var barEl = row.querySelector('.param-bar');
            if (labelEl) labelEl.textContent = cfg.name + ' (' + cfg.value + (cfg.unit || '') + ')';
            if (barEl) barEl.style.width = cfg.pct + '%';
        });

    }

    var runBtn = document.getElementById('runSimulationBtn') || document.querySelector('.btn-run-simulation');
    if (runBtn) runBtn.addEventListener('click', runNewSimulation);
});
