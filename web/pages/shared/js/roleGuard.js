import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, query, where, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doLogout } from './dropdownActions.js';

// Paths are relative to pages/shared/ and pages/technician/, which resolve the same.
const HOME = { admin: '../shared/dashboard.html', technician: '../technician/dashboard-technician.html' };
const LOGIN_URL   = '../security/admin-tech-login.html';
const SESSION_KEY = 'bantay-ulang-auth-user';

// Same mapping as normalizeRole in admin-tech-login.js so the guard never rejects a role login accepts.
function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (role.includes('admin')) return 'admin';
    if (role.includes('technician') || role.includes('tech')) return 'technician';
    return role;
}

function sessionStore() {
    try {
        if (localStorage.getItem(SESSION_KEY)) return localStorage;
        if (sessionStorage.getItem(SESSION_KEY)) return sessionStorage;
    } catch (_) {}
    return null;
}

function sessionRole() {
    try {
        const store = sessionStore();
        return store ? normalizeRole(JSON.parse(store.getItem(SESSION_KEY)).role) : '';
    } catch (_) {
        return '';
    }
}

// Keeps the head script in step with Firestore so a changed role cannot bounce between dashboards.
function syncSessionRole(role) {
    try {
        const store = sessionStore();
        if (!store) return;
        const record = JSON.parse(store.getItem(SESSION_KEY));
        if (record.role !== role) store.setItem(SESSION_KEY, JSON.stringify({ ...record, role }));
    } catch (_) {}
}

// Reads users/{uid}, falling back to the email lookup the login page uses.
async function fetchRole(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) return normalizeRole(snap.data().role);
    if (!user.email) return '';
    const byEmail = await getDocs(query(collection(db, 'users'), where('email', '==', user.email), limit(1)));
    return byEmail.empty ? '' : normalizeRole(byEmail.docs[0].data().role);
}

/**
 * requireRole('admin' | 'technician')
 * Signed out goes to login, the other staff role goes to its own dashboard,
 * and any other role is signed out. Never throws into page init.
 */
export function requireRole(required) {
    const unsub = onAuthStateChanged(auth, async (user) => {
        unsub();
        try {
            if (!user) { window.location.replace(LOGIN_URL); return; }

            let role;
            try {
                role = await fetchRole(user);
                syncSessionRole(role);
            } catch (err) {
                console.warn('[roleGuard] Role read failed, using session role:', err);
                role = sessionRole();
                if (!role) return; // Nothing to decide on; rules still gate the data.
            }

            if (role === required) return;
            if (HOME[role]) window.location.replace(HOME[role]);
            else await doLogout();
        } catch (err) {
            console.error('[roleGuard] Guard failed:', err);
        }
    });
}
