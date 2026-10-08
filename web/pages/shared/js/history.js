import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getReadingsInRangeWithStatus, catchUpCache } from "./readingsService.js";
import { loadThresholds } from "./thresholds.js";
import { initSidebar } from "./sidebar.js";
import { roleLabel } from "./roleLabels.js";
import { normalizeStatus } from "./taskStatus.js";
import { isSuspect } from "./plausibility.js";
import { computeRowStatus } from "./readingStatus.js";

const PAGE_SIZE = 20;
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — bounded default when no date filter is set
const CATCH_UP_MAX_PAGES = 19; // plus the range sync's own page: at most 20,000 reads per visit, the report's READ_BUDGET
const LOADING_TEXT = "Loading sensor readings…";

let statusFilter = "all";
let sourceFilter = "all";   // all | sensor | synthetic
let dateFromVal = "";
let dateToVal = "";
let currentPage = 0;
let filteredRows = [];      // {reading, status} pairs — the full status-filtered result for the current query
let effectiveRangeLabel = "";

const STATUS_LABEL     = { normal: "Normal", "out-of-range": "Out of Range", suspect: "Suspect", "no-data": "No Data", incomplete: "Incomplete" };
// Reuses the existing critical (red) palette for out-of-range rows/badges —
// avoids a CSS-only diff for what both display as "the bad bucket" now that
// warning/critical have collapsed into one. No-data and incomplete share grey.
// Suspect reuses the otherwise idle warning (amber) palette.
const STATUS_CSS_CLASS = { normal: "normal", "out-of-range": "critical", suspect: "warning", "no-data": "no-data", incomplete: "no-data" };

// ─── growth_indicators cycleStart (one-shot, mirrors dashboard.js/sensorHistoryModal.js) ──

function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function loadCycleStartMs() {
    try {
        const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
        if (snap.empty) return null;

        const cycleStart = toDateValue(snap.docs[0].data().cycleStart);
        return cycleStart ? cycleStart.getTime() : null;
    } catch (err) {
        console.warn("history: unable to load growth_indicators for cycleStart:", err);
        return null;
    }
}

let cycleStartMsPromise = null;
function getCycleStartMs() {
    if (!cycleStartMsPromise) cycleStartMsPromise = loadCycleStartMs();
    return cycleStartMsPromise;
}

// ─── Effective date range (bounded default) ─────────────────────────────────
// If either date field is left blank, defaults that end to a 30-day-bounded
// value instead of pulling the whole cycle into memory. Each field defaults
// independently, so an explicit "from" with no "to" still only defaults the
// missing end.
function resolveEffectiveRange() {
    const now = Date.now();

    let sinceMs;
    if (dateFromVal) {
        const d = new Date(dateFromVal);
        d.setHours(0, 0, 0, 0);
        sinceMs = d.getTime();
    } else {
        sinceMs = now - DEFAULT_RANGE_MS;
    }

    let untilMs;
    if (dateToVal) {
        const d = new Date(dateToVal);
        d.setHours(23, 59, 59, 999);
        untilMs = d.getTime();
    } else {
        untilMs = now;
    }

    return { sinceMs, untilMs };
}

function formatRangeLabel(sinceMs, untilMs) {
    const fmtDate = ms => new Date(ms).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
    return `${fmtDate(sinceMs)} – ${fmtDate(untilMs)}`;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function fmt(val, dec) {
    if (val == null || !Number.isFinite(Number(val))) return "—";
    return Number(val).toFixed(dec);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Suspect values render empty, with the raw value kept in the tooltip.
function valueCell(label, reading, param, dec) {
    const raw = reading[param];
    if (isSuspect(param, raw)) return `<td data-label="${label}" title="Suspect sensor value: ${escHtml(raw)}">—</td>`;
    return `<td data-label="${label}">${fmt(raw, dec)}</td>`;
}

function buildRow(row) {
    const tr = document.createElement("tr");
    const { reading, status } = row;
    const cssStatus = STATUS_CSS_CLASS[status] || "normal";
    tr.className = "sr-row sr-row--" + cssStatus;

    const ts = reading.measuredAtMs != null ? new Date(reading.measuredAtMs) : null;
    const tsStr = ts
        ? ts.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) +
          " · " +
          ts.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "—";

    const syntheticTag = reading.isSynthetic
        ? ` <span class="sr-tag sr-tag--synthetic" title="${escHtml(reading.dataSource || "Synthetic test data")}">Synthetic</span>`
        : "";

    tr.innerHTML = `
        <td data-label="Timestamp">${tsStr}${syntheticTag}</td>
        ${valueCell("pH Level", reading, "ph", 1)}
        ${valueCell("Water Temp (°C)", reading, "waterTemp", 1)}
        ${valueCell("DO (mg/L)", reading, "dissolvedOxygen", 1)}
        ${valueCell("Salinity (ppt)", reading, "salinity", 2)}
        ${valueCell("Turbidity (NTU)", reading, "turbidity", 1)}
        ${valueCell("TDS (ppm)", reading, "tds", 0)}
        <td data-label="Status"><span class="sr-status sr-status--${cssStatus}">${STATUS_LABEL[status] || capitalize(status)}</span></td>
    `;
    return tr;
}

function updatePaginationControls(hasPrev, hasNext) {
    const prevBtn = document.getElementById("srPrevBtn");
    const nextBtn = document.getElementById("srNextBtn");
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
}

function updatePageInfo(pageIndex, count, total) {
    const info = document.getElementById("srPageInfo");
    if (!info) return;
    if (total === 0) { info.textContent = `No records (${effectiveRangeLabel})`; return; }
    const from = pageIndex * PAGE_SIZE + 1;
    const to   = pageIndex * PAGE_SIZE + count;
    info.textContent = `${effectiveRangeLabel} · Showing ${from}–${to} of ${total}`;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

// Maps a Firestore error code to a user-facing next step.
function syncErrorHint(err) {
    if (err?.code === "permission-denied") return "Check that you're logged in.";
    if (err?.code === "resource-exhausted") return "Daily read limit reached; try again later.";
    return "Check your connection and try again.";
}

async function loadSensorReadings() {
    const tbody     = document.getElementById("sensorHistoryTbody");
    const loadingEl = document.getElementById("sensorHistoryLoading");
    const errorEl   = document.getElementById("sensorHistoryError");
    const loadingTextEl = document.getElementById("sensorHistoryLoadingText");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (loadingTextEl) loadingTextEl.textContent = LOADING_TEXT;
    if (loadingEl) loadingEl.style.display = "flex";
    if (errorEl)   errorEl.style.display   = "none";

    try {
        await loadThresholds();
        const cycleStartMs = await getCycleStartMs();
        const { sinceMs, untilMs } = resolveEffectiveRange();
        effectiveRangeLabel = formatRangeLabel(sinceMs, untilMs);

        // A stale browser would otherwise advance only one 1,000-reading page per visit.
        let synced = 0;
        const caughtUp = await catchUpCache(cycleStartMs, {
            maxIterations: CATCH_UP_MAX_PAGES,
            onPage: (n) => {
                synced += n;
                if (loadingTextEl && synced) loadingTextEl.textContent = `${LOADING_TEXT} ${synced.toLocaleString("en-PH")} synced`;
            }
        });

        const { rows: readings, syncError } = await getReadingsInRangeWithStatus(cycleStartMs, sinceMs, untilMs);

        // A failed sync with no cached rows is an error, not an empty farm.
        if (syncError && !readings.length) throw syncError;

        // Rows come back ascending; reverse for newest-first, matching
        // the old orderBy("timestamp","desc") behavior.
        filteredRows = readings
            .slice()
            .reverse()
            .map(reading => ({ reading, status: computeRowStatus(reading) }))
            .filter(row => statusFilter === "all" || row.status === statusFilter)
            .filter(row => sourceFilter === "all" || row.reading.isSynthetic === (sourceFilter === "synthetic"));

        if (loadingEl) loadingEl.style.display = "none";
        if (syncError && errorEl) {
            errorEl.textContent = "Showing cached readings; couldn't refresh from the server. " + syncErrorHint(syncError);
            errorEl.classList.add("sr-error--warning");
            errorEl.style.display = "block";
        } else if (!caughtUp && errorEl) {
            errorEl.textContent = "Still catching up on older readings; the newest may be missing. Reload to continue.";
            errorEl.classList.add("sr-error--warning");
            errorEl.style.display = "block";
        }
        renderPage(0);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Couldn't load readings. " + syncErrorHint(err);
            errorEl.classList.remove("sr-error--warning");
            errorEl.style.display = "block";
        }
        console.error("sensor readings history error:", err);
    }
}

function renderPage(pageIndex) {
    const tbody = document.getElementById("sensorHistoryTbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!filteredRows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="sr-empty">No sensor readings found.</td></tr>';
        currentPage = 0;
        updatePaginationControls(false, false);
        updatePageInfo(0, 0, 0);
        return;
    }

    const start = pageIndex * PAGE_SIZE;
    const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

    pageRows.forEach(row => tbody.appendChild(buildRow(row)));

    currentPage = pageIndex;
    updatePaginationControls(pageIndex > 0, start + PAGE_SIZE < filteredRows.length);
    updatePageInfo(pageIndex, pageRows.length, filteredRows.length);
}

function resetPagination() {
    currentPage = 0;
}

// ─── Assigned Task History ────────────────────────────────────────────────────
// Reads the real "tasks" collection. Two different writers exist in this
// codebase: assign-actions.js (manual admin assignment, sets assignedToName +
// assignedToRole) and alertsEngine.js (auto-generated, createdBy: "system",
// assignedTo may be null, role stored as assignedRole — a different field
// name than the manual writer uses). Both are checked below; this naming
// inconsistency is a known system-wide issue, not fixed here.
//
// Assignee display is resolved LIVE from the "users" collection (uid -> name),
// not from the stored assignedToName — assign-actions.js bakes the raw uid
// into assignedToName when the user has no fullName at assignment time, and
// alertsEngine.js never writes assignedToName at all. A live lookup means
// both cases resolve correctly, and a user who sets their name later isn't
// stuck showing an old id. See resolveAssignee() below.

const TASK_PAGE_SIZE = 20;
const TASK_COLL = "tasks";

let taskPageCursors = [null];
let taskCurrentPage = 0;
let taskHasMore = false;

// ─── uid -> display name (batch-fetched once, same pattern as
// assign-actions.js's loadUsers(), cached like getCycleStartMs() above) ────────

function resolveUserDisplayName(userData) {
    return userData.fullName || userData.displayName || userData.email || null;
}

let userNameMapPromise = null;

async function loadUserNameMap() {
    const map = new Map();
    try {
        const snap = await getDocs(collection(db, "users"));
        snap.forEach(d => {
            const name = resolveUserDisplayName(d.data());
            if (name) map.set(d.id, name);
        });
    } catch (err) {
        console.warn("history: could not load users for task assignee lookup:", err);
    }
    return map;
}

function getUserNameMap() {
    if (!userNameMapPromise) userNameMapPromise = loadUserNameMap();
    return userNameMapPromise;
}

// assignedTo is the source of truth; assignedToName is only trusted as a
// fallback when it's distinguishable from the raw uid — assign-actions.js
// writes assignedToName = personUid when the user had no fullName, so an
// exact match to assignedTo means "this is a baked-in id, not a name."
function resolveAssignee(data, userNameMap) {
    if (data.assignedTo == null) return "Unassigned";

    const liveName = userNameMap.get(data.assignedTo);
    if (liveName) return liveName;

    if (data.assignedToName && data.assignedToName !== data.assignedTo) {
        return data.assignedToName;
    }
    return "Unknown";
}

function buildTaskQuery(cursorDoc) {
    const clauses = [orderBy("createdAt", "desc")];
    if (cursorDoc) clauses.push(startAfter(cursorDoc));
    clauses.push(limit(TASK_PAGE_SIZE));
    return query(collection(db, TASK_COLL), ...clauses);
}

// Keys are normalizeStatus() output ('completed' covers both web 'completed' and mobile 'done').
const TASK_STATUS_CLASS = { pending: "pending", "in-progress": "in-progress", completed: "completed" };
const TASK_STATUS_LABEL = { pending: "Pending", "in-progress": "In Progress", completed: "Completed" };

function fmtTaskDate(ts) {
    const d = ts?.toDate?.();
    if (!d) return "—";
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

function buildTaskRow(data, userNameMap) {
    const tr = document.createElement("tr");

    const status      = normalizeStatus(data.status);
    const statusClass = TASK_STATUS_CLASS[status] || "pending";
    const statusLabel = TASK_STATUS_LABEL[status] || capitalize(status);

    // assignedToRole (assign-actions.js) vs assignedRole (alertsEngine.js) — check both.
    const role      = data.assignedToRole || data.assignedRole || "";
    const roleText  = roleLabel(role);
    const assignee  = resolveAssignee(data, userNameMap);

    const source = data.createdBy === "system" ? "System" : "Admin";

    tr.innerHTML = `
        <td data-label="Date Assigned">${fmtTaskDate(data.createdAt)}</td>
        <td data-label="Assigned To">
            <strong>${escHtml(assignee)}</strong>
            ${roleText ? `<div class="assignee-role">${escHtml(roleText)}</div>` : ""}
        </td>
        <td data-label="Task">${escHtml(data.title || "—")}</td>
        <td data-label="Status"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td data-label="Source">${source}</td>
    `;
    return tr;
}

function updateTaskPaginationControls(hasPrev, hasNext) {
    const prevBtn = document.getElementById("taskPrevBtn");
    const nextBtn = document.getElementById("taskNextBtn");
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
}

function updateTaskPageInfo(pageIndex, count) {
    const info = document.getElementById("taskPageInfo");
    if (!info) return;
    if (count === 0) { info.textContent = "No records"; return; }
    const from = pageIndex * TASK_PAGE_SIZE + 1;
    const to   = pageIndex * TASK_PAGE_SIZE + count;
    info.textContent = `Showing ${from}–${to}`;
}

async function loadTaskPage(pageIndex) {
    const tbody     = document.getElementById("taskHistoryTbody");
    const loadingEl = document.getElementById("taskHistoryLoading");
    const errorEl   = document.getElementById("taskHistoryError");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (loadingEl) loadingEl.style.display = "flex";
    if (errorEl)   errorEl.style.display   = "none";

    try {
        // Run concurrently: the users lookup only needs to resolve before rows
        // are built, not before the tasks query starts. getUserNameMap() is
        // memoized, so every page after the first awaits an already-resolved
        // promise here — no repeat fetch.
        const [snap, userNameMap] = await Promise.all([
            getDocs(buildTaskQuery(taskPageCursors[pageIndex] ?? null)),
            getUserNameMap()
        ]);
        if (loadingEl) loadingEl.style.display = "none";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="sr-empty">No assigned tasks found.</td></tr>';
            updateTaskPaginationControls(pageIndex > 0, false);
            updateTaskPageInfo(pageIndex, 0);
            return;
        }

        snap.forEach(doc => tbody.appendChild(buildTaskRow(doc.data(), userNameMap)));

        taskHasMore = snap.docs.length === TASK_PAGE_SIZE;
        if (taskHasMore && !taskPageCursors[pageIndex + 1]) {
            taskPageCursors[pageIndex + 1] = snap.docs[snap.docs.length - 1];
        }

        updateTaskPaginationControls(pageIndex > 0, taskHasMore);
        updateTaskPageInfo(pageIndex, snap.docs.length);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Error loading data: " + (err.message || err);
            errorEl.style.display = "block";
        }
        console.error("tasks history error:", err);
    }
}

// ─── Topbar / sidebar UI ──────────────────────────────────────────────────────

function setupTopbarSidebar() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    const notifDropdown   = topbar.querySelector(".notification-dropdown");
    const notifBtn        = topbar.querySelector(".notification-icon");

    notifBtn?.addEventListener("click", e => {
        e.stopPropagation();
        notifDropdown?.classList.toggle("show");
    });
    document.addEventListener("click", e => {
        if (topbar.contains(e.target)) return;
        notifDropdown?.classList.remove("show");
    });

    const sidebar  = document.getElementById("sidebar");
    const overlay  = document.getElementById("sidebarOverlay");
    const menuBtn  = document.getElementById("topbarMenuBtn");
    const appEl    = document.querySelector(".app");
    const toggleBtn = document.getElementById("sidebarToggleBtn");

    menuBtn?.addEventListener("click", () => {
        sidebar?.classList.add("open");
        overlay?.classList.add("show");
        overlay?.setAttribute("aria-hidden", "false");
    });
    overlay?.addEventListener("click", () => {
        sidebar?.classList.remove("open");
        overlay?.classList.remove("show");
        overlay?.setAttribute("aria-hidden", "true");
    });

    // Sidebar collapse/toggle, persistence and click-to-collapse.
    initSidebar();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
    setupTopbarSidebar();

    const statusSel = document.getElementById("srStatusFilter");
    const sourceSel = document.getElementById("srSourceFilter");
    const dateFromEl = document.getElementById("srDateFrom");
    const dateToEl   = document.getElementById("srDateTo");
    const applyBtn   = document.getElementById("srApplyFilters");
    const resetBtn   = document.getElementById("srResetFilters");
    const prevBtn    = document.getElementById("srPrevBtn");
    const nextBtn    = document.getElementById("srNextBtn");

    applyBtn?.addEventListener("click", () => {
        statusFilter = statusSel?.value ?? "all";
        sourceFilter = sourceSel?.value || "all";
        dateFromVal  = dateFromEl?.value ?? "";
        dateToVal    = dateToEl?.value ?? "";
        resetPagination();
        loadSensorReadings();
    });

    resetBtn?.addEventListener("click", () => {
        statusFilter = "all";
        sourceFilter = "all";
        dateFromVal  = "";
        dateToVal    = "";
        if (statusSel)  statusSel.value  = "all";
        if (sourceSel)  sourceSel.value  = "all";
        if (dateFromEl) dateFromEl.value = "";
        if (dateToEl)   dateToEl.value   = "";
        resetPagination();
        loadSensorReadings();
    });

    prevBtn?.addEventListener("click", () => {
        if (currentPage > 0) renderPage(currentPage - 1);
    });

    nextBtn?.addEventListener("click", () => {
        if ((currentPage + 1) * PAGE_SIZE < filteredRows.length) renderPage(currentPage + 1);
    });

    loadSensorReadings();

    const taskPrevBtn = document.getElementById("taskPrevBtn");
    const taskNextBtn = document.getElementById("taskNextBtn");

    taskPrevBtn?.addEventListener("click", () => {
        if (taskCurrentPage > 0) { taskCurrentPage--; loadTaskPage(taskCurrentPage); }
    });

    taskNextBtn?.addEventListener("click", () => {
        if (taskHasMore) { taskCurrentPage++; loadTaskPage(taskCurrentPage); }
    });

    loadTaskPage(0);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
