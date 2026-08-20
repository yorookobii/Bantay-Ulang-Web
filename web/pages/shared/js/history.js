import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getReadingsInRange } from "./readingsService.js";
import { loadThresholds, getRanges } from "./thresholds.js";

const PAGE_SIZE = 20;
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — bounded default when no date filter is set

let statusFilter = "all";
let dateFromVal = "";
let dateToVal = "";
let currentPage = 0;
let filteredRows = [];      // {reading, status} pairs — the full status-filtered result for the current query
let effectiveRangeLabel = "";

// ─── Status computation ─────────────────────────────────────────────────────
// HistoryLogs readings carry no stored status field (unlike the old sensor_readings
// docs) — status is computed client-side against thresholds.js. Binary only:
// within range = normal, any breach = out-of-range. No warning/critical split —
// there's no literature-backed ratio threshold to invent one.
//
// Reading field name -> thresholds.js key. Most match directly; "ph" is the one
// mismatch (thresholds.js still uses the legacy "phLevel" key). waterLevel is
// intentionally excluded: it's boolean, not a min/max-checkable numeric param
// (same reasoning as dropping its column/chart in Parts 5-6).
const THRESHOLD_KEY = {
    ph:              "phLevel",
    waterTemp:       "waterTemp",
    dissolvedOxygen: "dissolvedOxygen",
    salinity:        "salinity",
    turbidity:       "turbidity",
    tds:             "tds"
};
const STATUS_PARAMS = Object.keys(THRESHOLD_KEY);

function isBreached(param, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = getRanges()[THRESHOLD_KEY[param]];
    if (!range) return false;
    const hasMin = range.min !== null && range.min !== undefined;
    const hasMax = range.max !== null && range.max !== undefined;
    if (hasMin && value < range.min) return true;
    if (hasMax && value > range.max) return true;
    return false;
}

// Any-breach-wins: a row is out-of-range if ANY param breaches its threshold.
// Params with no configured threshold (e.g. tds if unset in Settings) simply
// can't breach — isBreached() returns false for them via the !range guard.
function computeRowStatus(reading) {
    return STATUS_PARAMS.some(param => isBreached(param, reading[param])) ? "out-of-range" : "normal";
}

const STATUS_LABEL     = { normal: "Normal", "out-of-range": "Out of Range" };
// Reuses the existing critical (red) palette for out-of-range rows/badges —
// avoids a CSS-only diff for what both display as "the bad bucket" now that
// warning/critical have collapsed into one.
const STATUS_CSS_CLASS = { normal: "normal", "out-of-range": "critical" };

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

    tr.innerHTML = `
        <td data-label="Timestamp">${tsStr}</td>
        <td data-label="pH Level">${fmt(reading.ph, 1)}</td>
        <td data-label="Water Temp (°C)">${fmt(reading.waterTemp, 1)}</td>
        <td data-label="DO (mg/L)">${fmt(reading.dissolvedOxygen, 1)}</td>
        <td data-label="Salinity (ppt)">${fmt(reading.salinity, 0)}</td>
        <td data-label="Turbidity (NTU)">${fmt(reading.turbidity, 1)}</td>
        <td data-label="TDS (ppm)">${fmt(reading.tds, 0)}</td>
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

async function loadSensorReadings() {
    const tbody     = document.getElementById("sensorHistoryTbody");
    const loadingEl = document.getElementById("sensorHistoryLoading");
    const errorEl   = document.getElementById("sensorHistoryError");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (loadingEl) loadingEl.style.display = "flex";
    if (errorEl)   errorEl.style.display   = "none";

    try {
        await loadThresholds();
        const cycleStartMs = await getCycleStartMs();
        const { sinceMs, untilMs } = resolveEffectiveRange();
        effectiveRangeLabel = formatRangeLabel(sinceMs, untilMs);

        const readings = await getReadingsInRange(cycleStartMs, sinceMs, untilMs);

        // getReadingsInRange returns ascending; reverse for newest-first, matching
        // the old orderBy("timestamp","desc") behavior.
        filteredRows = readings
            .slice()
            .reverse()
            .map(reading => ({ reading, status: computeRowStatus(reading) }))
            .filter(row => statusFilter === "all" || row.status === statusFilter);

        if (loadingEl) loadingEl.style.display = "none";
        renderPage(0);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Error loading data: " + (err.message || err);
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

const TASK_PAGE_SIZE = 20;
const TASK_COLL = "tasks";

let taskPageCursors = [null];
let taskCurrentPage = 0;
let taskHasMore = false;

function buildTaskQuery(cursorDoc) {
    const clauses = [orderBy("createdAt", "desc")];
    if (cursorDoc) clauses.push(startAfter(cursorDoc));
    clauses.push(limit(TASK_PAGE_SIZE));
    return query(collection(db, TASK_COLL), ...clauses);
}

const TASK_STATUS_CLASS = { pending: "pending", "in-progress": "in-progress", done: "completed" };
const TASK_STATUS_LABEL = { pending: "Pending", "in-progress": "In Progress", done: "Done" };

function fmtTaskDate(ts) {
    const d = ts?.toDate?.();
    if (!d) return "—";
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) +
        " · " + d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

function buildTaskRow(data) {
    const tr = document.createElement("tr");

    const status      = String(data.status || "pending").toLowerCase();
    const statusClass = TASK_STATUS_CLASS[status] || "pending";
    const statusLabel = TASK_STATUS_LABEL[status] || capitalize(status);

    // assignedToRole (assign-actions.js) vs assignedRole (alertsEngine.js) — check both.
    const role      = data.assignedToRole || data.assignedRole || "";
    const roleLabel = role ? capitalize(role) : "";
    const assignee  = data.assignedToName || (data.assignedTo == null ? "Unassigned" : data.assignedTo);

    const source = data.createdBy === "system" ? "System" : "Admin";

    tr.innerHTML = `
        <td data-label="Date Assigned">${fmtTaskDate(data.createdAt)}</td>
        <td data-label="Assigned To">
            <strong>${escHtml(assignee)}</strong>
            ${roleLabel ? `<div class="assignee-role">${escHtml(roleLabel)}</div>` : ""}
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
        const snap = await getDocs(buildTaskQuery(taskPageCursors[pageIndex] ?? null));
        if (loadingEl) loadingEl.style.display = "none";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="sr-empty">No assigned tasks found.</td></tr>';
            updateTaskPaginationControls(pageIndex > 0, false);
            updateTaskPageInfo(pageIndex, 0);
            return;
        }

        snap.forEach(doc => tbody.appendChild(buildTaskRow(doc.data())));

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
    const profileDropdown = topbar.querySelector(".profile-dropdown");
    const notifBtn        = topbar.querySelector(".notification-icon");
    const profileBtn      = topbar.querySelector(".admin-profile");

    notifBtn?.addEventListener("click", e => {
        e.stopPropagation();
        notifDropdown?.classList.toggle("show");
        profileDropdown?.classList.remove("show");
    });
    profileBtn?.addEventListener("click", e => {
        e.stopPropagation();
        profileDropdown?.classList.toggle("show");
        notifDropdown?.classList.remove("show");
    });
    document.addEventListener("click", e => {
        if (topbar.contains(e.target)) return;
        notifDropdown?.classList.remove("show");
        profileDropdown?.classList.remove("show");
    });

    // Logout
    topbar.querySelectorAll(".profile-menu-item").forEach(item => {
        if (item.textContent.includes("Logout")) {
            item.addEventListener("click", () => alert("Logging out…"));
        }
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

    if (sidebar && appEl && toggleBtn) {
        const isMobile = () => window.innerWidth <= 768;
        const setCollapsed = collapsed => {
            sidebar.classList.toggle("collapsed", collapsed);
            appEl.classList.toggle("sidebar-collapsed", collapsed);
            try { localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0"); } catch (_) {}
        };
        toggleBtn.addEventListener("click", () => {
            if (isMobile()) {
                sidebar.classList.remove("open");
                overlay?.classList.remove("show");
                overlay?.setAttribute("aria-hidden", "true");
            } else {
                const collapsed = !sidebar.classList.contains("collapsed");
                setCollapsed(collapsed);
                toggleBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
            }
        });
        if (!isMobile()) {
            try {
                if (localStorage.getItem("sidebar-collapsed") === "1") {
                    setCollapsed(true);
                    toggleBtn.setAttribute("aria-label", "Expand sidebar");
                }
            } catch (_) {}
        }
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
    setupTopbarSidebar();

    const statusSel = document.getElementById("srStatusFilter");
    const dateFromEl = document.getElementById("srDateFrom");
    const dateToEl   = document.getElementById("srDateTo");
    const applyBtn   = document.getElementById("srApplyFilters");
    const resetBtn   = document.getElementById("srResetFilters");
    const prevBtn    = document.getElementById("srPrevBtn");
    const nextBtn    = document.getElementById("srNextBtn");

    applyBtn?.addEventListener("click", () => {
        statusFilter = statusSel?.value ?? "all";
        dateFromVal  = dateFromEl?.value ?? "";
        dateToVal    = dateToEl?.value ?? "";
        resetPagination();
        loadSensorReadings();
    });

    resetBtn?.addEventListener("click", () => {
        statusFilter = "all";
        dateFromVal  = "";
        dateToVal    = "";
        if (statusSel)  statusSel.value  = "all";
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
