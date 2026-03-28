import { auth, db } from "../../assets/js/firebase-init.js";
import {
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const USERS_COLLECTION = "users";
const SESSION_KEY = "bantay-ulang-auth-user";
const ROLE_ROUTES = {
    admin: "../shared/dashboard.html",
    technician: "../technician/dashboard-technician.html"
};

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberInput = document.getElementById("remember-session");
const submitButton = document.getElementById("submit-btn");
const messageEl = document.getElementById("form-message");
const togglePasswordButton = document.getElementById("toggle-password");
const togglePasswordIcon = document.getElementById("toggle-password-icon");

let initialAuthCheckDone = false;

function setMessage(message, type) {
    messageEl.textContent = message || "";
    messageEl.className = "message";
    messageEl.classList.add(type ? "is-" + type : "is-info");
}

function setSubmitting(isSubmitting, label) {
    submitButton.disabled = isSubmitting;
    submitButton.textContent = label || "Login to Bantay Ulang";
}

function normalizeRole(value) {
    const role = String(value || "").trim().toLowerCase();

    if (role.includes("admin")) {
        return "admin";
    }

    if (role.includes("technician") || role.includes("tech")) {
        return "technician";
    }

    return role;
}

function isAllowedRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_ROUTES, role);
}

function isProfileActive(profile) {
    if (typeof profile?.isActive === "boolean") {
        return profile.isActive;
    }

    if (typeof profile?.active === "boolean") {
        return profile.active;
    }

    if (typeof profile?.status === "string") {
        const status = profile.status.trim().toLowerCase();
        return !["inactive", "disabled", "blocked", "suspended"].includes(status);
    }

    return true;
}

function getDisplayName(profile, firebaseUser) {
    return (
        profile?.fullName ||
        profile?.name ||
        profile?.displayName ||
        firebaseUser?.displayName ||
        firebaseUser?.email?.split("@")[0] ||
        "User"
    );
}

function saveSessionProfile(sessionUser, rememberSession) {
    try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        const storage = rememberSession ? localStorage : sessionStorage;
        storage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    } catch (storageError) {
        console.warn("Unable to store session profile.", storageError);
    }
}

async function findProfileByField(fieldName, value) {
    if (!value) {
        return null;
    }

    const snapshot = await getDocs(
        query(collection(db, USERS_COLLECTION), where(fieldName, "==", value), limit(1))
    );

    if (snapshot.empty) {
        return null;
    }

    const matchedDoc = snapshot.docs[0];
    return { id: matchedDoc.id, ...matchedDoc.data() };
}

async function getUserProfile(firebaseUser) {
    const directRefs = [doc(db, USERS_COLLECTION, firebaseUser.uid)];

    if (firebaseUser.email) {
        directRefs.push(doc(db, USERS_COLLECTION, firebaseUser.email));

        const lowerEmail = firebaseUser.email.toLowerCase();
        if (lowerEmail !== firebaseUser.email) {
            directRefs.push(doc(db, USERS_COLLECTION, lowerEmail));
        }
    }

    for (const ref of directRefs) {
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
            return { id: snapshot.id, ...snapshot.data() };
        }
    }

    const profileByUid = await findProfileByField("uid", firebaseUser.uid);
    if (profileByUid) {
        return profileByUid;
    }

    const profileByEmail = await findProfileByField("email", firebaseUser.email);
    if (profileByEmail) {
        return profileByEmail;
    }

    const lowerEmail = firebaseUser.email ? firebaseUser.email.toLowerCase() : "";
    if (lowerEmail) {
        const lowerProfile = await findProfileByField("email", lowerEmail);
        if (lowerProfile) {
            return lowerProfile;
        }
    }

    return null;
}

async function validateAndRoute(firebaseUser, rememberSession) {
    const profile = await getUserProfile(firebaseUser);

    if (!profile) {
        await signOut(auth);
        setMessage("Login succeeded, but no matching Firestore user profile was found in the users collection.", "error");
        return;
    }

    const role = normalizeRole(profile.role || profile.userRole || profile.accountType);

    if (!isAllowedRole(role)) {
        await signOut(auth);
        setMessage("This page only allows admin and technician accounts.", "error");
        return;
    }

    if (!isProfileActive(profile)) {
        await signOut(auth);
        setMessage("Your account is currently inactive. Please contact an administrator.", "error");
        return;
    }

    const sessionUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || "",
        name: getDisplayName(profile, firebaseUser),
        role,
        profileId: profile.id || null
    };

    saveSessionProfile(sessionUser, rememberSession);
    setMessage("Login successful. Redirecting to your workspace...", "success");
    window.setTimeout(function() {
        window.location.href = ROLE_ROUTES[role];
    }, 450);
}

togglePasswordButton.addEventListener("click", function() {
    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    togglePasswordIcon.className = showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    togglePasswordButton.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
});

form.addEventListener("submit", async function(event) {
    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberSession = rememberInput.checked;

    if (!email || !password) {
        setMessage("Please enter both your email address and password.", "error");
        return;
    }

    setSubmitting(true, "Signing you in...");
    setMessage("Verifying your account and Firestore access...", "info");

    try {
        await setPersistence(
            auth,
            rememberSession ? browserLocalPersistence : browserSessionPersistence
        );

        const credentials = await signInWithEmailAndPassword(auth, email, password);
        await validateAndRoute(credentials.user, rememberSession);
    } catch (error) {
        console.error("Login failed:", error);

        const errorMessages = {
            "auth/invalid-credential": "Incorrect email or password. Please try again.",
            "auth/invalid-email": "Please enter a valid email address.",
            "auth/missing-password": "Please enter your password.",
            "auth/too-many-requests": "Too many attempts were made. Please wait a moment before trying again."
        };

        setMessage(errorMessages[error.code] || "Unable to log in right now. Please check your account details and try again.", "error");
    } finally {
        setSubmitting(false, "Login to Bantay Ulang");
    }
});

onAuthStateChanged(auth, async function(firebaseUser) {
    if (initialAuthCheckDone) {
        return;
    }

    initialAuthCheckDone = true;

    if (!firebaseUser) {
        setMessage("Waiting for your credentials.", "info");
        return;
    }

    setSubmitting(true, "Restoring session...");
    setMessage("Existing session found. Checking your Firestore access...", "info");

    try {
        const rememberSession = localStorage.getItem(SESSION_KEY) !== null;
        await validateAndRoute(firebaseUser, rememberSession);
    } catch (error) {
        console.error("Session restore failed:", error);
        setMessage("We found a saved session, but it could not be validated.", "error");
    } finally {
        setSubmitting(false, "Login to Bantay Ulang");
    }
});
