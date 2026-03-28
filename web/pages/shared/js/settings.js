function toggleNotification() {
    const dropdown = document.getElementById('notificationDropdown');
    dropdown.classList.toggle('show');
    
    // Close profile dropdown when opening notification
    const profileDropdown = document.getElementById('profileDropdown');
    profileDropdown.classList.remove('show');
}

function toggleProfile() {
    const dropdown = document.getElementById('profileDropdown');
    dropdown.classList.toggle('show');
    
    // Close notification dropdown when opening profile
    const notificationDropdown = document.getElementById('notificationDropdown');
    notificationDropdown.classList.remove('show');
}

function logout() {
    alert('Logging out...');
    // Implement logout logic here
}

// Water parameters threshold: load/save
(function() {
    var STORAGE_KEY = 'bantay_ulang_water_thresholds';
    var form = document.getElementById('threshold-form');
    var msgEl = document.getElementById('threshold-saved-msg');
    var fields = ['ph_min', 'ph_max', 'temp_min', 'temp_max', 'o2_min', 'salinity_min', 'salinity_max', 'nitrate_max', 'ammonia_max'];

    function loadThresholds() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            fields.forEach(function(name) {
                var el = document.getElementById(name);
                if (el && data[name] != null) el.value = data[name];
            });
        } catch (e) {}
    }

    function saveThresholds() {
        var data = {};
        fields.forEach(function(name) {
            var el = document.getElementById(name);
            if (el) data[name] = parseFloat(el.value);
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {}
    }

    loadThresholds();

    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveThresholds();
            if (msgEl) {
                msgEl.classList.add('show');
                setTimeout(function() { msgEl.classList.remove('show'); }, 3000);
            }
        });
    }
})();

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
    const notificationContainer = document.querySelector('.notification-container');
    const adminProfile = document.querySelector('.admin-profile');
    
    if (!notificationContainer.contains(event.target)) {
        document.getElementById('notificationDropdown').classList.remove('show');
    }
    
    if (!adminProfile.contains(event.target) && !event.target.closest('.profile-dropdown')) {
        document.getElementById('profileDropdown').classList.remove('show');
    }
});

// Sidebar open/close on mobile
(function() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var menuBtn = document.getElementById('topbarMenuBtn');
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
})();

// Sidebar toggle: collapse on desktop, close drawer on mobile
(function() {
    var sidebar = document.getElementById('sidebar');
    var app = document.querySelector('.app');
    var sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    var overlay = document.getElementById('sidebarOverlay');
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
})();
