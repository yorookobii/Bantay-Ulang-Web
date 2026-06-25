import { auth, db } from './firebase.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const form        = document.getElementById('profile-form');
const fullNameEl  = document.getElementById('profile-fullname');
const emailEl     = document.getElementById('profile-email');
const roleEl      = document.getElementById('profile-role');
const msgEl       = document.getElementById('profile-msg');
const saveBtn     = document.getElementById('profile-save-btn');
const avatarCircle = document.getElementById('profileAvatarCircle');
const displayName  = document.getElementById('profileDisplayName');
const displayRole  = document.getElementById('profileDisplayRole');

let currentUserUid = null;

function showMsg(text, color) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = color;
    setTimeout(() => { msgEl.textContent = ''; }, 3500);
}

// ── Auth guard + profile load ─────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../security/admin-tech-login.html';
        return;
    }
    currentUserUid = user.uid;

    try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data = snap.exists() ? snap.data() : {};
        const fullName = data.fullName || user.displayName || '';
        const role     = data.role || '';
        const initial  = (fullName || user.email || 'U').charAt(0).toUpperCase();

        if (fullNameEl) fullNameEl.value  = fullName;
        if (emailEl)    emailEl.value     = user.email || '';
        if (roleEl)     roleEl.value      = role;

        if (avatarCircle)  avatarCircle.textContent  = initial;
        if (displayName)   displayName.textContent   = fullName || user.email || 'User';
        if (displayRole)   displayRole.textContent   = role;
    } catch (err) {
        console.warn('[profile] Could not load user data:', err);
        showMsg('Could not load profile data. Please refresh.', '#dc2626');
    }
});

// ── Save handler ──────────────────────────────────────────────────────────────

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUserUid) {
            showMsg('Not logged in.', '#dc2626'); return;
        }
        const fullName = fullNameEl?.value.trim();
        if (!fullName) {
            showMsg('Full name cannot be empty.', '#dc2626'); return;
        }

        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; }

        try {
            await updateDoc(doc(db, 'users', currentUserUid), { fullName });

            // Update the avatar and display immediately
            const initial = fullName.charAt(0).toUpperCase();
            if (avatarCircle)  avatarCircle.textContent = initial;
            if (displayName)   displayName.textContent  = fullName;

            showMsg('Profile saved successfully.', '#16a34a');
        } catch (err) {
            console.error('[profile] Update failed:', err);
            showMsg('Failed to save. Please try again.', '#dc2626');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Changes'; }
        }
    });
}

// ── Sidebar: mobile open/close ────────────────────────────────────────────────

(function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('topbarMenuBtn');
    if (sidebar && overlay && menuBtn) {
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
    }
})();

// ── Sidebar: collapse/expand on desktop ──────────────────────────────────────

(function () {
    const sidebar       = document.getElementById('sidebar');
    const app           = document.querySelector('.app');
    const sidebarToggle = document.getElementById('sidebarToggleBtn');
    const overlay       = document.getElementById('sidebarOverlay');

    if (!sidebar || !app || !sidebarToggle) return;

    function isMobile() { return window.innerWidth <= 768; }

    function setCollapsed(collapsed) {
        sidebar.classList.toggle('collapsed', collapsed);
        app.classList.toggle('sidebar-collapsed', collapsed);
        try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); } catch (_) {}
    }

    sidebarToggle.addEventListener('click', () => {
        if (isMobile()) {
            sidebar.classList.remove('open');
            if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
        } else {
            const collapsed = !sidebar.classList.contains('collapsed');
            setCollapsed(collapsed);
            sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        }
    });

    if (!isMobile()) {
        try {
            if (localStorage.getItem('sidebar-collapsed') === '1') {
                setCollapsed(true);
                sidebarToggle.setAttribute('aria-label', 'Expand sidebar');
            }
        } catch (_) {}
    }
})();
