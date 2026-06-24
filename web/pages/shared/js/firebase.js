// Import Firebase core
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// Import Firestore
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Import Auth
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Import Analytics (optional)
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDK4Bw3fQpJGlt5kqDJvz8w-xQdZZLQO2M",
  authDomain: "bantay-ulang.firebaseapp.com",
  projectId: "bantay-ulang",
  storageBucket: "bantay-ulang.firebasestorage.app",
  messagingSenderId: "827033380382",
  appId: "1:827033380382:web:fa26f915847d837f5e300f",
  measurementId: "G-1DVHW69G6W"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (THIS IS THE DATABASE)
const db = getFirestore(app);

// Initialize Firebase Authentication
const auth = getAuth(app);

// Keep Analytics from blocking Firestore in unsupported environments.
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (error) {
  console.warn("Firebase Analytics is unavailable in this environment.", error);
}

// Export Firebase services so other files can use them
export { auth, db, analytics };
