import { auth, db } from './firebase.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const THRESHOLDS_DOC = doc(db, 'settings', 'thresholds');

const FIELDS = [
    'ph_min', 'ph_max',
    'temp_min', 'temp_max',
    'o2_min',
    'salinity_min', 'salinity_max',
    'turbidity_max',
    'waterlevel_min', 'waterlevel_max'
];

// ── Load thresholds from Firestore into the form ─────────────────────────────

async function loadThresholds() {
    try {
        const snap = await getDoc(THRESHOLDS_DOC);
        if (!snap.exists()) return;
        const data = snap.data();
        FIELDS.forEach(name => {
            const el = document.getElementById(name);
            if (el && data[name] != null) el.value = data[name];
        });
    } catch (err) {
        console.warn('[settings] Could not load thresholds from Firestore:', err);
    }
}

// ── Save thresholds to Firestore ─────────────────────────────────────────────

async function saveThresholds() {
    const data = {};
    FIELDS.forEach(name => {
        const el = document.getElementById(name);
        if (el) data[name] = parseFloat(el.value);
    });
    await setDoc(THRESHOLDS_DOC, data, { merge: true });
}

// ── Form submit handler ───────────────────────────────────────────────────────

const form  = document.getElementById('threshold-form');
const msgEl = document.getElementById('threshold-saved-msg');

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            await saveThresholds();
            if (msgEl) {
                msgEl.textContent = 'Thresholds saved successfully.';
                msgEl.classList.add('show');
                setTimeout(() => msgEl.classList.remove('show'), 3000);
            }
        } catch (err) {
            console.error('[settings] Save failed:', err);
            if (msgEl) {
                msgEl.textContent = 'Failed to save. Check your connection and try again.';
                msgEl.style.color = '#dc2626';
                msgEl.classList.add('show');
                setTimeout(() => { msgEl.classList.remove('show'); msgEl.style.color = ''; }, 4000);
            }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '✓ Save thresholds'; }
        }
    });
}

// ── Auth guard — load thresholds once user is confirmed ───────────────────────

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '../security/admin-tech-login.html';
        return;
    }
    loadThresholds();
});

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
    const sidebar        = document.getElementById('sidebar');
    const app            = document.querySelector('.app');
    const sidebarToggle  = document.getElementById('sidebarToggleBtn');
    const overlay        = document.getElementById('sidebarOverlay');

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
