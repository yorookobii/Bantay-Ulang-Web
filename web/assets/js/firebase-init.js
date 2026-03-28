import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDK4Bw3fQpJGlt5kqDJvz8w-xQdZZLQO2M",
    authDomain: "bantay-ulang.firebaseapp.com",
    projectId: "bantay-ulang",
    storageBucket: "bantay-ulang.firebasestorage.app",
    messagingSenderId: "827033380382",
    appId: "1:827033380382:web:fa26f915847d837f5e300f",
    measurementId: "G-1DVHW69G6W"
};

const app = initializeApp(firebaseConfig);

let analytics = null;
try {
    analytics = getAnalytics(app);
} catch (err) {
    console.warn("Firebase Analytics is unavailable in this environment.", err);
}

const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const storage = getStorage(app);

// Expose services for non-module scripts.
window.firebaseApp = app;
window.firebaseServices = { auth, db, rtdb, storage, analytics };
document.dispatchEvent(new CustomEvent("firebase-ready", {
    detail: { app, auth, db, rtdb, storage, analytics }
}));

export { app, auth, db, rtdb, storage, analytics };
