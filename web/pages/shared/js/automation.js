
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