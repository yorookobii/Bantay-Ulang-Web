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

            /* Live sensor data simulation – runs automatically, no refresh needed */
            (function() {
                function runLiveSensors() {
                    var sensorGrid = document.getElementById('sensorGrid');
                    if (!sensorGrid) return;

                    function randInRange(min, max, decimals) {
                        var v = min + Math.random() * (max - min);
                        return decimals === 0 ? Math.round(v) : Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);
                    }

                    function formatUpdated(secAgo) {
                        if (secAgo < 30) return 'Updated: Just now';
                        if (secAgo < 60) return 'Updated: &lt; 1 min ago';
                        var mins = Math.floor(secAgo / 60);
                        return mins === 1 ? 'Updated: 1 min ago' : 'Updated: ' + mins + ' mins ago';
                    }

                    var lastUpdate = {};

                    function tick() {
                        var cards = sensorGrid.querySelectorAll('.sensor-card[data-base]');
                        var now = Date.now();
                        cards.forEach(function(card) {
                            var min = parseFloat(card.getAttribute('data-min'));
                            var max = parseFloat(card.getAttribute('data-max'));
                            var unit = card.getAttribute('data-unit') || '';
                            var decimals = parseInt(card.getAttribute('data-decimals'), 10) || 1;
                            var valueEl = card.querySelector('.sensor-value');
                            var updatedEl = card.querySelector('.sensor-updated');
                            if (!valueEl) return;
                            var newVal = randInRange(min, max, decimals);
                            valueEl.textContent = newVal + unit;
                            var key = card.getAttribute('data-sensor');
                            if (!lastUpdate[key]) lastUpdate[key] = now;
                            if (Math.random() < 0.4) lastUpdate[key] = now;
                            if (updatedEl) {
                                var secAgo = Math.floor((now - lastUpdate[key]) / 1000);
                                updatedEl.innerHTML = formatUpdated(secAgo);
                            }
                        });
                    }

                    function runClock() {
                        var cards = sensorGrid.querySelectorAll('.sensor-card[data-base]');
                        var now = Date.now();
                        cards.forEach(function(card) {
                            var key = card.getAttribute('data-sensor');
                            var updatedEl = card.querySelector('.sensor-updated');
                            if (updatedEl && lastUpdate[key]) {
                                var secAgo = Math.floor((now - lastUpdate[key]) / 1000);
                                updatedEl.innerHTML = formatUpdated(secAgo);
                            }
                        });
                    }

                    tick();
                    setInterval(tick, 3000);
                    setInterval(runClock, 1000);
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', runLiveSensors);
                } else {
                    runLiveSensors();
                }
            })();
