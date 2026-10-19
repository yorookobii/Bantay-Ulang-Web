import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

let analytics = null;
try {
    if (firebaseConfig.measurementId) analytics = getAnalytics(app);
} catch (err) {
    console.warn("Firebase Analytics is unavailable in this environment.", err);
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Expose services for non-module scripts.
window.firebaseApp = app;
window.firebaseServices = { auth, db, storage, analytics };
document.dispatchEvent(new CustomEvent("firebase-ready", {
    detail: { app, auth, db, storage, analytics }
}));

export { app, auth, db, storage, analytics };
