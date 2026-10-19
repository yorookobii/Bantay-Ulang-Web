// Import Firebase core
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// Import Firestore
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Import Auth
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Import Analytics (optional)
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// Shared Firebase configuration (one copy for the whole web app)
import { firebaseConfig } from "../../../assets/js/firebase-config.js";


// Reuse the app created by firebase-init.js if it already exists on this page,
// otherwise initialize fresh (e.g. on pages that don't load firebase-init.js).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore (THIS IS THE DATABASE)
const db = getFirestore(app);

// Initialize Firebase Authentication
const auth = getAuth(app);

// Keep Analytics from blocking Firestore in unsupported environments.
let analytics = null;
try {
  if (firebaseConfig.measurementId) analytics = getAnalytics(app);
} catch (error) {
  console.warn("Firebase Analytics is unavailable in this environment.", error);
}

// Export Firebase services so other files can use them
export { auth, db, analytics };
