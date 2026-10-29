import { db } from "./firebase.js";
import { collection, getDocs, query, limit, orderBy, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Actuator Log panel: one-time fetch of the last 7 PHT days of ActionLogs, built with textContent only (docs are device-writable).

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Philippines is UTC+8 with no daylight saving.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 7;
const PER_DAY = 50;
const MAX_ROWS = 25;
const COLUMNS = ["When", "Action", "Reason", "Duration", "Status"];

const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : null);
const str = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const text = (v) => str(v) || "—";

// "YYYY-MM-DD" for today and the previous days in PHT, newest first.
function phtDays() {
    const base = Date.now() + MANILA_OFFSET_MS;
    return Array.from({ length: DAYS }, (_, i) => new Date(base - i * DAY_MS).toISOString().slice(0, 10));
}

// Sort key: completedAt, then measuredAt, then date + time strings, then the folder day.
function sortKey(d, day) {
    const parsed = Date.parse(`${str(d.date)}T${str(d.time)}+08:00`);
    return tsMs(d.completedAt) ?? tsMs(d.measuredAt) ?? (Number.isFinite(parsed) ? parsed : Date.parse(`${day}T00:00:00+08:00`));
}

function whenText(d) {
    if (str(d.date) && str(d.time)) return `${str(d.date)} ${str(d.time)}`;
    const ms = tsMs(d.completedAt) ?? tsMs(d.measuredAt);
    return ms == null ? "—" : new Date(ms).toLocaleString("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit"
    });
}

async function fetchRows() {
    const rows = [];
    for (const day of phtDays()) {
        const [y, m, dd] = day.split("-");
        const ref = collection(db, "ActionLogs", "Ulang", "years", `action_${y}`, `action_${m}`, `action_${dd}`, "actions");
        const snap = await getDocs(query(ref, orderBy(documentId(), "desc"), limit(PER_DAY)));
        snap.forEach(s => rows.push({ data: s.data(), key: sortKey(s.data(), day) }));
        if (rows.length >= MAX_ROWS) break;
    }
    return rows.sort((a, b) => b.key - a.key).slice(0, MAX_ROWS).map(r => r.data);
}

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
}

function buildTable(rows) {
    const table = el("table", "fr-table");
    const headRow = table.createTHead().insertRow();
    COLUMNS.forEach(c => headRow.appendChild(el("th", null, c)));
    const tbody = table.createTBody();
    for (const d of rows) {
        const tr = tbody.insertRow();
        const status = el("td", null, text(d.status));
        if (d.physicalActuatorEnabled === false) status.appendChild(el("span", "al-badge", "Simulated"));
        const cells = [
            el("td", null, whenText(d)),
            el("td", null, text(d.action)),
            el("td", null, text(d.triggerReason)),
            el("td", null, Number.isFinite(d.durationMs) ? `${+(d.durationMs / 1000).toFixed(1)} s` : "—"),
            status
        ];
        cells.forEach((td, i) => { td.dataset.label = COLUMNS[i]; tr.appendChild(td); });
    }
    const wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    return wrap;
}

/** Wires the panel; reads happen only on first open and on Refresh. */
export function initActuatorLog({ panel, body, refreshBtn }) {
    let loaded = false;

    async function load() {
        refreshBtn.disabled = true;
        const spinner = el("div", "fr-loading");
        spinner.append(el("i", "fa-solid fa-spinner fa-spin"), "Loading actuator log…");
        body.replaceChildren(spinner);
        try {
            const rows = await fetchRows();
            body.replaceChildren(rows.length ? buildTable(rows) : el("p", "fr-empty", "No actuator actions in the last 7 days."));
        } catch (err) {
            console.error("Actuator log load error:", err);
            body.replaceChildren(el("p", "fr-empty al-error", "Failed to load actuator log."));
        } finally {
            refreshBtn.disabled = false;
        }
    }

    panel.addEventListener("toggle", () => {
        if (!panel.open || loaded) return;
        loaded = true;
        load();
    });
    refreshBtn.addEventListener("click", load);
}
