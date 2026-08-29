import { auth, db } from './firebase.js';
import {
    signOut,
    reauthenticateWithCredential,
    EmailAuthProvider,
    updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection,
    query,
    where,
    getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const isOnTechnicianPage = window.location.pathname.includes('/technician/');
const BASE = isOnTechnicianPage ? '../shared/' : './';
const PROFILE_URL  = `${BASE}profile.html`;
const SETTINGS_URL = `${BASE}settings.html`;
const LOGIN_URL    = '../security/admin-tech-login.html';
const SESSION_KEY  = 'bantay-ulang-auth-user';

function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
}

async function doLogout() {
    try { await signOut(auth); } catch (e) { console.error('Logout error:', e); }
    clearSession();
    window.location.href = LOGIN_URL;
}

// ── Change Password modal ────────────────────────────────────────────────────

function buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'cp-overlay';
    overlay.style.cssText = [
        'display:none', 'position:fixed', 'inset:0',
        'background:rgba(0,0,0,0.5)', 'z-index:9999',
        'align-items:center', 'justify-content:center'
    ].join(';');

    overlay.innerHTML = `
<div style="background:#fff;border-radius:12px;padding:32px;width:420px;max-width:92vw;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.18);">
  <button id="cp-close" type="button"
    style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1;">&#x2715;</button>
  <h3 style="margin:0 0 4px;font-size:17px;font-weight:700;color:#111827;font-family:'Segoe UI',sans-serif;">Change Password</h3>
  <p style="margin:0 0 22px;font-size:13px;color:#6b7280;font-family:'Segoe UI',sans-serif;">Enter your current password to verify, then set a new one.</p>
  <form id="cp-form" autocomplete="off">
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;font-family:'Segoe UI',sans-serif;">Current Password</label>
      <input type="password" id="cp-current" autocomplete="current-password" required
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;">
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;font-family:'Segoe UI',sans-serif;">New Password</label>
      <input type="password" id="cp-new" autocomplete="new-password" required minlength="6"
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;">
    </div>
    <div style="margin-bottom:18px;">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;font-family:'Segoe UI',sans-serif;">Confirm New Password</label>
      <input type="password" id="cp-confirm" autocomplete="new-password" required minlength="6"
        style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;">
    </div>
    <p id="cp-msg" style="font-size:13px;min-height:18px;margin-bottom:12px;font-family:'Segoe UI',sans-serif;"></p>
    <button type="submit" id="cp-submit"
      style="width:100%;padding:11px;background:#15212e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Segoe UI',sans-serif;">
      Update Password
    </button>
  </form>
</div>`;

    document.body.appendChild(overlay);

    const form    = overlay.querySelector('#cp-form');
    const msgEl   = overlay.querySelector('#cp-msg');
    const closeBtn = overlay.querySelector('#cp-close');

    function showMsg(text, color) { msgEl.textContent = text; msgEl.style.color = color; }

    closeBtn.addEventListener('click', () => closeModal());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user || !user.email) {
            showMsg('No logged-in user found.', '#dc2626'); return;
        }
        const currentPwd = document.getElementById('cp-current').value;
        const newPwd     = document.getElementById('cp-new').value;
        const confirmPwd = document.getElementById('cp-confirm').value;

        if (newPwd !== confirmPwd) {
            showMsg('New passwords do not match.', '#dc2626'); return;
        }
        if (newPwd.length < 6) {
            showMsg('Password must be at least 6 characters.', '#dc2626'); return;
        }

        const submitBtn = overlay.querySelector('#cp-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';
        showMsg('', '');

        try {
            const credential = EmailAuthProvider.credential(user.email, currentPwd);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPwd);
            showMsg('Password updated successfully.', '#16a34a');
            form.reset();
            setTimeout(() => closeModal(), 1800);
        } catch (err) {
            const msgs = {
                'auth/wrong-password':        'Current password is incorrect.',
                'auth/invalid-credential':    'Current password is incorrect.',
                'auth/too-many-requests':     'Too many attempts. Please wait before trying again.',
                'auth/weak-password':         'New password is too weak. Use at least 6 characters.',
                'auth/requires-recent-login': 'Session expired. Please log out and log in again.'
            };
            showMsg(msgs[err.code] || 'Failed to update password. Please try again.', '#dc2626');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update Password';
        }
    });
}

function openModal() {
    const overlay = document.getElementById('cp-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.getElementById('cp-current')?.focus();
}

function closeModal() {
    const overlay = document.getElementById('cp-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.getElementById('cp-msg').textContent = '';
    document.getElementById('cp-form').reset();
}

// ── Notification bell (active alerts) ────────────────────────────────────────

// localStorage analog of Flutter's SharedPreferences seen-notification set
// (see notification_service.dart / landing_page.dart) — same key, same
// "alert:<docId>" entry format, so seen state has the same shape on both.
const SEEN_KEY = 'seen_notification_keys';

const SEVERITY_ICON = {
    critical: { icon: 'fa-solid fa-triangle-exclamation', color: '#dc2626' },
    high:     { icon: 'fa-solid fa-circle-exclamation',   color: '#ea580c' },
    medium:   { icon: 'fa-solid fa-circle-exclamation',   color: '#d97706' },
    low:      { icon: 'fa-solid fa-circle-info',          color: '#2563eb' }
};

function getSeenKeys() {
    try {
        return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []);
    } catch (_) {
        return new Set();
    }
}

function markSeen(keys) {
    const seen = getSeenKeys();
    keys.forEach((key) => seen.add(key));
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch (_) {}
}

function formatRelativeTime(date) {
    if (!date) return '';
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

async function fetchActiveAlerts() {
    // Filters by status only (matches dashboard.js:232-239) so no composite
    // Firestore index is required; sort/limit happen client-side instead.
    const snap = await getDocs(query(collection(db, 'alerts'), where('status', '==', 'active')));
    return snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 15);
}

function renderNotifications(dropdownEl, alerts) {
    if (!alerts.length) {
        dropdownEl.innerHTML = '<div class="notification-item">No new notifications</div>';
        return;
    }
    dropdownEl.innerHTML = alerts.map((alert) => {
        const { icon, color } = SEVERITY_ICON[alert.severity] || SEVERITY_ICON.low;
        const time = formatRelativeTime(alert.createdAt?.toDate?.());
        return `<div class="notification-item">
            <i class="${icon}" style="color:${color}"></i>
            <span>${alert.message || 'Alert'}${time ? ` <small style="color:#9ca3af;">(${time})</small>` : ''}</span>
        </div>`;
    }).join('');
}

function updateBadge(badgeEl, unseenCount) {
    if (!badgeEl) return;
    badgeEl.textContent = unseenCount > 9 ? '9+' : String(unseenCount);
    badgeEl.style.display = unseenCount > 0 ? 'inline-block' : 'none';
}

async function populateNotifications() {
    const notifDropdown = document.getElementById('notificationDropdown');
    if (!notifDropdown) return;

    const notifIcon = document.querySelector('.notification-icon');
    const badgeEl   = document.querySelector('.notification-badge');

    let alerts = [];
    try {
        alerts = await fetchActiveAlerts();
    } catch (err) {
        console.warn('Unable to load active alerts.', err);
    }

    renderNotifications(notifDropdown, alerts);

    const seen = getSeenKeys();
    const unseenCount = alerts.filter((alert) => !seen.has(`alert:${alert.id}`)).length;
    updateBadge(badgeEl, unseenCount);

    if (notifIcon) {
        notifIcon.addEventListener('click', () => {
            markSeen(alerts.map((alert) => `alert:${alert.id}`));
            updateBadge(badgeEl, 0);
        });
    }
}

// ── Public init ──────────────────────────────────────────────────────────────

/**
 * initDropdown({ handleToggle })
 *
 * handleToggle (default true): wire the admin-profile click and outside-click
 * to open/close the dropdown.  Pass false on pages like dashboard.html that
 * already handle the toggle in their own JS.
 */
export function initDropdown({ handleToggle = true } = {}) {
    buildModal();
    populateNotifications();

    if (handleToggle) {
        const notifIcon      = document.querySelector('.notification-icon');
        const notifDropdown  = document.getElementById('notificationDropdown');
        const adminProfile   = document.querySelector('.admin-profile');
        const profileDropdown = document.getElementById('profileDropdown');

        if (adminProfile && profileDropdown) {
            adminProfile.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = profileDropdown.classList.toggle('show');
                if (notifDropdown && open) notifDropdown.classList.remove('show');
            });
        }
        if (notifIcon && notifDropdown) {
            notifIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = notifDropdown.classList.toggle('show');
                if (profileDropdown && open) profileDropdown.classList.remove('show');
            });
        }
        document.addEventListener('click', () => {
            profileDropdown?.classList.remove('show');
            notifDropdown?.classList.remove('show');
        });
    }

    document.querySelectorAll('.profile-menu-item').forEach(item => {
        const text = item.textContent.trim();
        if (text.includes('My Profile')) {
            item.addEventListener('click', () => { window.location.href = PROFILE_URL; });
        } else if (text.includes('Settings')) {
            item.addEventListener('click', () => { window.location.href = SETTINGS_URL; });
        } else if (text.includes('Change Password')) {
            item.addEventListener('click', openModal);
        } else if (text.includes('Logout')) {
            if (item.id === 'logoutMenuItem') return; // already handled by dashboard.js
            item.removeAttribute('onclick');
            item.addEventListener('click', doLogout);
        }
    });
}
