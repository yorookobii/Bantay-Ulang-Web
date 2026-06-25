import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export function loadUserProfile() {
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
        } catch (err) {
            console.warn('Could not load user profile:', err);
        }
    });
}
