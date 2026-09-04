import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const CACHE_KEY = 'bantay-ulang-user-cache';

function paintCachedProfile() {
    let cached;
    try {
        cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch (err) {
        return; // corrupt/inaccessible cache - leave existing placeholders
    }
    if (!cached) return;

    if (cached.fullName) {
        document.querySelectorAll('.user-name, .admin-name').forEach(el => {
            el.textContent = cached.fullName;
        });
    }
    if (cached.role) {
        document.querySelectorAll('.user-role, .admin-role').forEach(el => {
            el.textContent = cached.role;
        });
    }
    if (cached.initial) {
        document.querySelectorAll('.user-avatar > span, .admin-avatar > span').forEach(el => {
            el.textContent = cached.initial;
        });
    }
}

export function loadUserProfile() {
    paintCachedProfile();

    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        try {
            const snap = await getDoc(doc(db, 'users', user.uid));
            const data = snap.exists() ? snap.data() : {};
            const fullName = data.fullName || user.displayName || user.email || 'User';
            const role = data.role || 'User';
            const initial = fullName.charAt(0).toUpperCase();

            document.querySelectorAll('.user-name, .admin-name').forEach(el => {
                el.textContent = fullName;
            });
            document.querySelectorAll('.user-role, .admin-role').forEach(el => {
                el.textContent = role;
            });
            document.querySelectorAll('.user-avatar > span, .admin-avatar > span').forEach(el => {
                el.textContent = initial;
            });

            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ fullName, role, initial }));
            } catch (err) {
                // storage unavailable (private mode/quota) - cache is best-effort
            }
        } catch (err) {
            console.warn('Could not load user profile:', err);
        }
    });
}
