            (function() {
                function init() {
                    var container = document.querySelector('.topbar');
                    if (!container) return;
                    var notifDropdown = container.querySelector('.notification-dropdown');
                    var profileDropdown = container.querySelector('.profile-dropdown');
                    var notifBtn = container.querySelector('.notification-icon');
                    var profileBtn = container.querySelector('.admin-profile');
                    function toggleDropdown(btn, dropdown, otherBtn, otherDropdown) {
                        var open = dropdown.classList.toggle('show');
                        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                        if (open && otherDropdown) {
                            otherDropdown.classList.remove('show');
                            if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
                        }
                    }
                    function activateOnKey(el, handler) {
                        el.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                                e.preventDefault();
                                handler(e);
                            }
                        });
                    }
                    if (notifBtn && notifDropdown) {
                        var onNotifToggle = function(e) {
                            e.stopPropagation();
                            toggleDropdown(notifBtn, notifDropdown, profileBtn, profileDropdown);
                        };
                        notifBtn.addEventListener('click', onNotifToggle);
                        activateOnKey(notifBtn, onNotifToggle);
                    }
                    if (profileBtn && profileDropdown) {
                        var onProfileToggle = function(e) {
                            e.stopPropagation();
                            toggleDropdown(profileBtn, profileDropdown, notifBtn, notifDropdown);
                        };
                        profileBtn.addEventListener('click', onProfileToggle);
                        activateOnKey(profileBtn, onProfileToggle);
                    }
                    document.addEventListener('click', function(e) {
                        if (container.contains(e.target)) return;
                        if (notifDropdown) { notifDropdown.classList.remove('show'); if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false'); }
                        if (profileDropdown) { profileDropdown.classList.remove('show'); if (profileBtn) profileBtn.setAttribute('aria-expanded', 'false'); }
                    });
                    // Logout is handled by dropdownActions.js's initDropdown() (real
                    // Firebase sign-out); this page used to also bind a fake
                    // alert()-only handler here, which fired alongside the real one.

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

            /* Sensor cards: honest loading placeholder until real Firestore data arrives */
            (function() {
                function showLoadingState() {
                    var sensorGrid = document.getElementById('sensorGrid');
                    if (!sensorGrid) return;

                    var cards = sensorGrid.querySelectorAll('.sensor-card[data-sensor]');
                    cards.forEach(function(card) {
                        var valueEl   = card.querySelector('.sensor-value');
                        var updatedEl = card.querySelector('.sensor-updated');
                        if (valueEl)   valueEl.textContent   = '--';
                        if (updatedEl) updatedEl.textContent = 'Updated: --';
                    });
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', showLoadingState);
                } else {
                    showLoadingState();
                }
            })();
