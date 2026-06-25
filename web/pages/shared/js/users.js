import { db, auth } from './firebase.js';
import { signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection, onSnapshot, doc, getDoc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Global functions for onclick attrs in HTML ────────────────────────────
window.toggleNotification = function () {
    const nd = document.getElementById('notificationDropdown');
    const pd = document.getElementById('profileDropdown');
    nd?.classList.toggle('show');
    pd?.classList.remove('show');
};

window.toggleProfile = function () {
    const pd = document.getElementById('profileDropdown');
    const nd = document.getElementById('notificationDropdown');
    pd?.classList.toggle('show');
    nd?.classList.remove('show');
};

window.logout = async function () {
    try { await signOut(auth); } catch (_) {}
    window.location.href = '../security/admin-tech-login.html';
};

// ── Sidebar: hamburger opens drawer, overlay closes it ────────────────────
(function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('topbarMenuBtn');
    if (!sidebar || !overlay || !menuBtn) return;
    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
    });
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
    });
})();

// ── Sidebar toggle: collapse on desktop, close drawer on mobile ───────────
(function () {
    const sidebar = document.getElementById('sidebar');
    const app     = document.querySelector('.app');
    const btn     = document.getElementById('sidebarToggleBtn');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !app || !btn) return;
    const isMobile = () => window.innerWidth <= 768;
    const setCollapsed = (v) => {
        sidebar.classList.toggle('collapsed', v);
        app.classList.toggle('sidebar-collapsed', v);
        try { localStorage.setItem('sidebar-collapsed', v ? '1' : '0'); } catch (_) {}
    };
    btn.addEventListener('click', () => {
        if (isMobile()) {
            sidebar.classList.remove('open');
            overlay?.classList.remove('show');
            overlay?.setAttribute('aria-hidden', 'true');
        } else {
            const v = !sidebar.classList.contains('collapsed');
            setCollapsed(v);
            btn.setAttribute('aria-label', v ? 'Expand sidebar' : 'Collapse sidebar');
        }
    });
    if (!isMobile()) {
        try {
            if (localStorage.getItem('sidebar-collapsed') === '1') {
                setCollapsed(true);
                btn.setAttribute('aria-label', 'Expand sidebar');
            }
        } catch (_) {}
    }
})();

// ── Close dropdowns when clicking outside ─────────────────────────────────
document.addEventListener('click', (e) => {
    const nc = document.querySelector('.notification-container');
    const ap = document.querySelector('.admin-profile');
    if (nc && !nc.contains(e.target))
        document.getElementById('notificationDropdown')?.classList.remove('show');
    if (ap && !ap.contains(e.target) && !e.target.closest('.profile-dropdown'))
        document.getElementById('profileDropdown')?.classList.remove('show');
});

// ── Toast notification ────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    let t = document.getElementById('um-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'um-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = `um-toast um-toast-${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Build a single user card ──────────────────────────────────────────────
function buildCard(uid, data, canEdit) {
    const name    = data.fullName || data.displayName || 'Unknown User';
    const email   = data.email   || '';
    const role    = (data.role   || 'user').toLowerCase();
    const status  = (data.status || 'active').toLowerCase();
    const initial = name.charAt(0).toUpperCase();

    const card = document.createElement('div');
    card.className = 'user_container';
    card.dataset.uid = uid;

    card.innerHTML = `
        <div class="user_profile">
            <span class="user-initial">${initial}</span>
        </div>
        <div class="user_information">
            <h4>${name}</h4>
            <p>${email}</p>
        </div>
        <div class="user_controls">
            <div class="ctrl-group">
                <label>Role</label>
                <select class="um-select role-select"${canEdit ? '' : ' disabled'}>
                    <option value="admin"${role === 'admin' ? ' selected' : ''}>Admin</option>
                    <option value="technician"${role === 'technician' ? ' selected' : ''}>Technician</option>
                    <option value="user"${role === 'user' ? ' selected' : ''}>User</option>
                </select>
            </div>
            <div class="ctrl-group">
                <label>Status</label>
                <select class="um-select status-select status-${status}"${canEdit ? '' : ' disabled'}>
                    <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
                    <option value="inactive"${status === 'inactive' ? ' selected' : ''}>Inactive</option>
                </select>
            </div>
        </div>
        <div class="user_actions">
            <button class="um-delete-btn" title="Remove user from Firestore"${canEdit ? '' : ' disabled'}>
                <i class="fas fa-trash-alt"></i> Delete
            </button>
        </div>
    `;

    if (!canEdit) return card;

    // Role change — revert on error
    const roleSel = card.querySelector('.role-select');
    roleSel.addEventListener('change', async (e) => {
        const newRole = e.target.value;
        const prevRole = role;
        try {
            await updateDoc(doc(db, 'users', uid), { role: newRole });
            showToast(`Role updated to ${newRole.charAt(0).toUpperCase() + newRole.slice(1)}`);
        } catch (err) {
            roleSel.value = prevRole;
            showToast('Failed to update role: ' + (err.code || err.message), 'error');
            console.error('updateDoc role error:', err);
        }
    });

    // Status change — update class only after write succeeds; revert on error
    const statusSel = card.querySelector('.status-select');
    statusSel.addEventListener('change', async (e) => {
        const newStatus = e.target.value;
        const prevStatus = status;
        try {
            await updateDoc(doc(db, 'users', uid), { status: newStatus });
            statusSel.className = `um-select status-select status-${newStatus}`;
            showToast(`Status updated to ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`);
        } catch (err) {
            statusSel.value = prevStatus;
            showToast('Failed to update status: ' + (err.code || err.message), 'error');
            console.error('updateDoc status error:', err);
        }
    });

    // Delete (Firestore only, not Firebase Auth)
    card.querySelector('.um-delete-btn').addEventListener('click', async () => {
        if (!confirm(`Delete "${name}" from Firestore? This cannot be undone.`)) return;
        try {
            await deleteDoc(doc(db, 'users', uid));
            showToast(`${name} removed`);
        } catch (err) {
            showToast('Failed to delete: ' + (err.code || err.message), 'error');
            console.error('deleteDoc error:', err);
        }
    });

    return card;
}

// ── Render all users grouped by role ─────────────────────────────────────
const GROUPS = [
    { key: 'admin',      label: 'Admins',      icon: 'fa-shield-halved', cls: 'admins'      },
    { key: 'technician', label: 'Technicians', icon: 'fa-wrench',        cls: 'technicians' },
    { key: 'user',       label: 'Users',       icon: 'fa-user',          cls: 'users'       },
];

function makeRenderUsers(canEdit) {
    return function renderUsers(snapshot) {
        const container = document.getElementById('users-container');
        const loading   = document.getElementById('users-loading');
        if (!container) return;
        if (loading) loading.style.display = 'none';
        container.innerHTML = '';

        const byRole = { admin: [], technician: [], user: [] };
        snapshot.forEach(d => {
            const role = (d.data().role || 'user').toLowerCase();
            const bucket = byRole[role] ?? byRole.user;
            bucket.push({ uid: d.id, data: d.data() });
        });

        let total = 0;
        for (const g of GROUPS) {
            const list = byRole[g.key];
            if (!list || list.length === 0) continue;
            total += list.length;

            const section = document.createElement('section');
            section.className = 'user_section';
            section.innerHTML = `
                <h3 class="user_section_title ${g.cls}">
                    <i class="fa-solid ${g.icon}"></i> ${g.label}
                    <span class="um-count">${list.length}</span>
                </h3>
                <div class="user_cards"></div>
            `;
            const grid = section.querySelector('.user_cards');
            for (const { uid, data } of list) grid.appendChild(buildCard(uid, data, canEdit));
            container.appendChild(section);
        }

        if (total === 0) {
            container.innerHTML = `
                <div class="um-empty">
                    <i class="fas fa-users-slash"></i>
                    <p>No users found in the system.</p>
                </div>
            `;
        }
    };
}

// ── Auth-gated Firestore listener ─────────────────────────────────────────
// Waits for Firebase Auth to resolve, reads the current user's role from
// Firestore, then subscribes to the users collection.  Controls are disabled
// for non-admins so they cannot trigger writes that the security rules deny.
onAuthStateChanged(auth, async (user) => {
    const loading = document.getElementById('users-loading');

    if (!user) {
        if (loading) loading.innerHTML = '<p class="um-error">You must be logged in to view this page.</p>';
        return;
    }

    let canEdit = false;
    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const role = snap.exists() ? (snap.data().role || 'user').toLowerCase() : 'user';
        canEdit = role === 'admin';
    } catch (err) {
        console.warn('Could not verify admin role:', err);
    }

    onSnapshot(collection(db, 'users'), makeRenderUsers(canEdit), (err) => {
        console.error('Firestore snapshot error:', err.code, err.message);
        if (loading) loading.innerHTML = `<p class="um-error">Failed to load users (${err.code || err.message}).</p>`;
    });
});
