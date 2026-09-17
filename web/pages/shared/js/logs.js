import { auth, db } from "./firebase.js";
import {
    collection,
    getDocs,
    orderBy,
    query,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initSidebar } from "./sidebar.js";

const LOGS_LIMIT = 100;

// Set by onAuthStateChanged before the first loadLogs() call - see init().
let currentUid = null;

// ── Field helpers (copied from dashboard.js; not exported there) ──────────────

function getTextField(data, keys, fallback = "") {
    for (const key of keys) {
        const value = data?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value);
        }
    }

    return fallback;
}

function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Date + time (unlike dashboard's time-only formatLogTime): this page spans weeks.
function formatLogDateTime(value) {
    const date = toDateValue(value);
    if (!date) return "—";

    return date.toLocaleString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// ── Normalize + render ──────────────────────────────────────────────────────

// Mirrors dashboard.js applyRecentLogsSnapshot field mapping.
// Display-level only: creator name is blanked here for logs the viewer
// doesn't own, but the raw document (createdBy/createdByName/createdByEmail)
// is still readable by any authenticated client - this is not redaction.
function normalizeLog(doc) {
    const data = doc.data();
    const rawTime = data.createdAt || data.timestamp || data.loggedAt || data.date;
    const loggedAt = toDateValue(rawTime);
    const createdBy = data.createdBy;
    const isOwnLog = !createdBy || createdBy === currentUid;

    return {
        sortValue: loggedAt ? loggedAt.getTime() : 0,
        timeText: formatLogDateTime(rawTime),
        type: getTextField(data, ["status", "type", "level"], "").toLowerCase(),
        actor: isOwnLog
            ? getTextField(data, ["role", "actor", "user", "source", "by", "createdByName", "createdByEmail"], "System")
            : "Ibang User",
        title: getTextField(data, ["action", "title", "event", "name"], doc.id),
        description: getTextField(data, ["details", "description", "message"], "No details provided.")
    };
}

function td(label, text) {
    const cell = document.createElement("td");
    cell.dataset.label = label;              // drives history.css td::before on mobile
    if (text) cell.textContent = text;
    return cell;
}

function renderRows(entries) {
    const tbody = document.getElementById("logsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="sr-empty">No system logs found.</td></tr>';
        return;
    }

    for (const entry of entries) {
        const tr = document.createElement("tr");

        tr.appendChild(td("Time", entry.timeText));

        const typeTd = td("Type", "");
        const badge = document.createElement("span");
        badge.className = "log-type-badge";
        if (entry.type) badge.dataset.type = entry.type;
        badge.textContent = entry.type || "—";
        typeTd.appendChild(badge);
        tr.appendChild(typeTd);

        tr.appendChild(td("Actor", entry.actor));
        tr.appendChild(td("Title", entry.title));
        tr.appendChild(td("Description", entry.description));

        tbody.appendChild(tr);
    }
}

// ── Load ────────────────────────────────────────────────────────────────────

async function loadLogs() {
    const loadingEl = document.getElementById("logsLoading");
    const errorEl = document.getElementById("logsError");

    try {
        const snap = await getDocs(
            query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(LOGS_LIMIT))
        );
        if (loadingEl) loadingEl.style.display = "none";

        const rows = snap.docs
            .map(normalizeLog)
            .sort((a, b) => b.sortValue - a.sortValue);

        renderRows(rows);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Could not load logs: " + (err.code || err.message);
            errorEl.style.display = "block";
        }
        console.error("[logs] load failed:", err);
    }
}

// ── Init ────────────────────────────────────────────────────────────────────

function init() {
    initSidebar();
    // Wait for auth to resolve before the first fetch/render so currentUid
    // is set before normalizeLog() runs - avoids a name flash or wrongly
    // blanking the viewer's own logs on first paint.
    onAuthStateChanged(auth, (user) => {
        currentUid = user?.uid || null;
        loadLogs();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
