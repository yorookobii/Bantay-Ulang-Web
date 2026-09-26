            (function() {
                function init() {
                    var container = document.querySelector('.topbar');
                    if (!container) return;
                    var notifDropdown = container.querySelector('.notification-dropdown');
                    var notifBtn = container.querySelector('.notification-icon');
                    function toggleDropdown(btn, dropdown) {
                        var open = dropdown.classList.toggle('show');
                        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
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
                            toggleDropdown(notifBtn, notifDropdown);
                        };
                        notifBtn.addEventListener('click', onNotifToggle);
                        activateOnKey(notifBtn, onNotifToggle);
                    }
                    document.addEventListener('click', function(e) {
                        if (container.contains(e.target)) return;
                        if (notifDropdown) { notifDropdown.classList.remove('show'); if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false'); }
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

                    /* Sidebar collapse/toggle is wired by shared/js/sidebar.js (initSidebar). */
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
