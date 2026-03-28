(function() {
    var assignRole = document.getElementById('assignRole');
    var assignPerson = document.getElementById('assignPerson');
    var optionsByRole = {};
    Array.prototype.forEach.call(assignPerson.querySelectorAll('option[data-role]'), function(opt) {
        var r = opt.getAttribute('data-role');
        if (!optionsByRole[r]) optionsByRole[r] = [];
        optionsByRole[r].push(opt);
    });

    function filterPersonByRole() {
        var role = assignRole.value;
        Array.prototype.forEach.call(assignPerson.querySelectorAll('option'), function(opt) {
            if (opt.value === '') {
                opt.style.display = 'block';
                return;
            }
            var r = opt.getAttribute('data-role');
            opt.style.display = (!role || r === role) ? 'block' : 'none';
        });
        assignPerson.value = '';
    }
    if (assignRole) assignRole.addEventListener('change', filterPersonByRole);

    var form = document.getElementById('assignForm');
    var tbody = document.getElementById('assignmentsBody');
    function formatDate(str) {
        if (!str) return '';
        var d = new Date(str);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function addRow(assignee, roleLabel, action, dueDate, notes) {
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + (assignee || '') + '</td>' +
            '<td>' + (roleLabel || '') + '</td>' +
            '<td>' + (action || '') + '</td>' +
            '<td>' + formatDate(dueDate) + '</td>' +
            '<td><span class="status-badge status-pending">Pending</span></td>' +
            '<td><button type="button" class="btn-remove" title="Remove"><i class="fa-solid fa-trash-can"></i></button></td>';
        var removeBtn = tr.querySelector('.btn-remove');
        if (removeBtn) removeBtn.addEventListener('click', function() { tr.remove(); });
        tbody.appendChild(tr);
    }
    tbody.querySelectorAll('.btn-remove').forEach(function(btn) {
        btn.addEventListener('click', function() {
            btn.closest('tr').remove();
        });
    });
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            var person = assignPerson.value;
            var roleVal = assignRole.value;
            var roleLabel = roleVal === 'technician' ? 'Technician' : (roleVal === 'user' ? 'User' : '');
            var action = document.getElementById('actionType').value;
            var dueDate = document.getElementById('dueDate').value;
            var notes = (document.getElementById('notes').value || '').trim();
            if (!person || !action || !dueDate) return;
            addRow(person, roleLabel, action, dueDate, notes);
            form.reset();
            assignPerson.innerHTML = '<option value="">Select person…</option>';
            if (optionsByRole.user) optionsByRole.user.forEach(function(o) { assignPerson.appendChild(o.cloneNode(true)); });
            if (optionsByRole.technician) optionsByRole.technician.forEach(function(o) { assignPerson.appendChild(o.cloneNode(true)); });
            filterPersonByRole();
        });
    }

    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var menuBtn = document.getElementById('topbarMenuBtn');
    var app = document.querySelector('.app');
    if (sidebar && overlay && menuBtn) {
        menuBtn.addEventListener('click', function() {
            sidebar.classList.add('open');
            overlay.classList.add('show');
        });
        overlay.addEventListener('click', function() {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        });
    }
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
            try { localStorage.setItem('dashboard-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
        }
        sidebarToggleBtn.addEventListener('click', function() {
            if (isMobile()) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('show');
            } else {
                var c = !sidebar.classList.contains('collapsed');
                setCollapsed(c);
            }
        });
        if (!isMobile() && localStorage.getItem('dashboard-sidebar-collapsed') === '1') setCollapsed(true);
    }
    var notifBtn = document.querySelector('.notification-icon');
    var profileBtn = document.querySelector('.admin-profile');
    if (notifBtn && document.getElementById('notificationDropdown')) {
        notifBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.getElementById('notificationDropdown').classList.toggle('show');
            if (profileBtn && document.getElementById('profileDropdown')) document.getElementById('profileDropdown').classList.remove('show');
        });
    }
    if (profileBtn && document.getElementById('profileDropdown')) {
        profileBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            document.getElementById('profileDropdown').classList.toggle('show');
            if (notifBtn && document.getElementById('notificationDropdown')) document.getElementById('notificationDropdown').classList.remove('show');
        });
    }
    document.addEventListener('click', function(e) {
        if (!document.querySelector('.topbar').contains(e.target)) {
            var nd = document.getElementById('notificationDropdown');
            var pd = document.getElementById('profileDropdown');
            if (nd) nd.classList.remove('show');
            if (pd) pd.classList.remove('show');
        }
    });
})();
