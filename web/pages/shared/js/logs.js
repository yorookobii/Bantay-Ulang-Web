import { db } from "./firebase.js";
import {
    collection,
    getDocs,
    orderBy,
    query,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initSidebar } from "./sidebar.js";
import { toDateValue, normalizeLogData } from "./logEntry.js";

const LOGS_LIMIT = 100;

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

function normalizeLog(doc) {
    const entry = normalizeLogData(doc.data(), doc.id);
    return {
        ...entry,
        sortValue: entry.loggedAt ? entry.loggedAt.getTime() : 0,
        timeText: formatLogDateTime(entry.loggedAt)
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
    loadLogs();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
