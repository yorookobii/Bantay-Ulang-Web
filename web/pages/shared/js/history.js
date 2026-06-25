import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    where,
    getDocs,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const PAGE_SIZE = 20;
const COLL = "sensor_readings";

let statusFilter = "all";
let dateFromVal = "";
let dateToVal = "";
// pageCursors[i] = startAfter doc for page i (null = first page, no cursor)
let pageCursors = [null];
let currentPage = 0;
let hasMore = false;

// ─── Query builder ───────────────────────────────────────────────────────────
// Note: combining where("status","==",…) + orderBy("timestamp","desc") requires
// a Firestore composite index (status ASC + timestamp DESC). The console error
// will include a direct link to create it in the Firebase console.

function buildQuery(cursorDoc) {
    const clauses = [];

    if (statusFilter !== "all") {
        clauses.push(where("status", "==", statusFilter));
    }
    if (dateFromVal) {
        const d = new Date(dateFromVal);
        d.setHours(0, 0, 0, 0);
        clauses.push(where("timestamp", ">=", Timestamp.fromDate(d)));
    }
    if (dateToVal) {
        const d = new Date(dateToVal);
        d.setHours(23, 59, 59, 999);
        clauses.push(where("timestamp", "<=", Timestamp.fromDate(d)));
    }

    clauses.push(orderBy("timestamp", "desc"));
    if (cursorDoc) clauses.push(startAfter(cursorDoc));
    clauses.push(limit(PAGE_SIZE));

    return query(collection(db, COLL), ...clauses);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function fmt(val, dec) {
    if (val == null || !Number.isFinite(Number(val))) return "—";
    return Number(val).toFixed(dec);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildRow(data) {
    const tr = document.createElement("tr");
    const status = String(data.status || "normal").toLowerCase();
    tr.className = "sr-row sr-row--" + status;

    const ts = data.timestamp?.toDate?.();
    const tsStr = ts
        ? ts.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) +
          " · " +
          ts.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "—";

    tr.innerHTML = `
        <td data-label="Timestamp">${tsStr}</td>
        <td data-label="pH Level">${fmt(data.phLevel, 1)}</td>
        <td data-label="Water Temp (°C)">${fmt(data.waterTemp, 1)}</td>
        <td data-label="DO (mg/L)">${fmt(data.dissolvedOxygen, 1)}</td>
        <td data-label="Salinity (ppt)">${fmt(data.salinity, 0)}</td>
        <td data-label="Turbidity (NTU)">${fmt(data.turbidity, 1)}</td>
        <td data-label="Water Level (m)">${fmt(data.waterLevel, 2)}</td>
        <td data-label="Status"><span class="sr-status sr-status--${status}">${capitalize(status)}</span></td>
    `;
    return tr;
}

function updatePaginationControls(hasPrev, hasNext) {
    const prevBtn = document.getElementById("srPrevBtn");
    const nextBtn = document.getElementById("srNextBtn");
    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;
}

function updatePageInfo(pageIndex, count) {
    const info = document.getElementById("srPageInfo");
    if (!info) return;
    if (count === 0) { info.textContent = "No records"; return; }
    const from = pageIndex * PAGE_SIZE + 1;
    const to   = pageIndex * PAGE_SIZE + count;
    info.textContent = `Showing ${from}–${to}`;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadPage(pageIndex) {
    const tbody     = document.getElementById("sensorHistoryTbody");
    const loadingEl = document.getElementById("sensorHistoryLoading");
    const errorEl   = document.getElementById("sensorHistoryError");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (loadingEl) loadingEl.style.display = "flex";
    if (errorEl)   errorEl.style.display   = "none";

    try {
        const snap = await getDocs(buildQuery(pageCursors[pageIndex] ?? null));
        if (loadingEl) loadingEl.style.display = "none";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="8" class="sr-empty">No sensor readings found.</td></tr>';
            updatePaginationControls(pageIndex > 0, false);
            updatePageInfo(pageIndex, 0);
            return;
        }

        snap.forEach(doc => tbody.appendChild(buildRow(doc.data())));

        hasMore = snap.docs.length === PAGE_SIZE;
        if (hasMore && !pageCursors[pageIndex + 1]) {
            pageCursors[pageIndex + 1] = snap.docs[snap.docs.length - 1];
        }

        updatePaginationControls(pageIndex > 0, hasMore);
        updatePageInfo(pageIndex, snap.docs.length);
    } catch (err) {
        if (loadingEl) loadingEl.style.display = "none";
        if (errorEl) {
            errorEl.textContent = "Error loading data: " + (err.message || err);
            errorEl.style.display = "block";
        }
        console.error("sensor_readings history error:", err);
    }
}

function resetPagination() {
    pageCursors = [null];
    currentPage = 0;
    hasMore = false;
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
        loadPage(0);
    });

    resetBtn?.addEventListener("click", () => {
        statusFilter = "all";
        dateFromVal  = "";
        dateToVal    = "";
        if (statusSel)  statusSel.value  = "all";
        if (dateFromEl) dateFromEl.value = "";
        if (dateToEl)   dateToEl.value   = "";
        resetPagination();
        loadPage(0);
    });

    prevBtn?.addEventListener("click", () => {
        if (currentPage > 0) { currentPage--; loadPage(currentPage); }
    });

    nextBtn?.addEventListener("click", () => {
        if (hasMore) { currentPage++; loadPage(currentPage); }
    });

    loadPage(0);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
