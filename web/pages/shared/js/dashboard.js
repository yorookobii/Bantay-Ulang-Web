import { auth, db } from "./firebase.js";
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, serverTimestamp, limit, orderBy, query, where, Timestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { loadThresholds } from "./thresholds.js";
import { initSidebar } from "./sidebar.js";
import { reevaluateActiveAlerts } from "./alertsEngine.js";
import { initEnvTrendsChart, refreshEnvTrendsChart } from "./envTrendsChart.js";
import { AQUAPONICS_REF, normalizeAquaponicsReading } from "./aquaponicsReading.js";

const AUTH_SESSION_KEY = "bantay-ulang-auth-user";
const LOGIN_PAGE = "../security/admin-tech-login.html";

function clearSavedAuthSession() {
    try {
        localStorage.removeItem(AUTH_SESSION_KEY);
        sessionStorage.removeItem(AUTH_SESSION_KEY);
    } catch (error) {
        console.warn("Unable to clear saved auth session.", error);
    }
}

async function handleLogout(logoutElement, profileDropdown) {
    if (logoutElement) {
        logoutElement.style.pointerEvents = "none";
        logoutElement.style.opacity = "0.6";
        logoutElement.textContent = "Signing out...";
    }

    if (profileDropdown) {
        profileDropdown.classList.remove("show");
    }

    try {
        await signOut(auth);
        clearSavedAuthSession();
        window.location.href = LOGIN_PAGE;
    } catch (error) {
        console.error("Logout failed:", error);
        if (logoutElement) {
            logoutElement.textContent = "🚪 Logout";
            logoutElement.style.pointerEvents = "";
            logoutElement.style.opacity = "";
        }
        window.alert("Unable to log out right now. Please try again.");
    }
}

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

function formatLogTime(value, fallback = "Just now") {
    const date = toDateValue(value);
    if (!date) return fallback;

    return date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

// ── System Hardware Status (Aquaponics/Ulang data freshness) ──────────────────

const HW_ONLINE_THRESHOLD_MS = 90 * 1000;   // <90s = Online (~6 missed cycles at ~15s/tick)
const HW_STALE_THRESHOLD_MS  = 300 * 1000;  // 90s–300s = Stale; >300s (5m) = Offline
const HW_CHECK_INTERVAL_MS   = 15 * 1000;   // Periodic age re-check interval

// Aquaponics/Ulang has no measuredAt field yet (firmware doesn't write one), so
// freshness falls back to diffing a signature of its statistics.* values across
// snapshots. Persisted in localStorage (not sessionStorage) so a genuinely
// offline system stays Offline across a hard refresh or tab close/reopen —
// this is what actually reproduced the "resets to Online on navigation" bug.
const HW_FRESHNESS_STORAGE_KEY = "bantay_hw_status_freshness";

let latestHardwareMeasuredAt = null; // Date | null
let hardwareTimer = null;
let hwLastChangeAt  = null; // ms epoch | null — last time the signature actually changed
let hwLastSignature = null; // string | null — last-seen statistics signature

function loadHwFreshnessFromStorage() {
    try {
        const raw = localStorage.getItem(HW_FRESHNESS_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        const lastChangeAt = Number(parsed?.lastChangeAt);
        const lastSignature = parsed?.lastSignature;

        if (!Number.isFinite(lastChangeAt) || typeof lastSignature !== "string") return;

        hwLastChangeAt = lastChangeAt;
        hwLastSignature = lastSignature;
    } catch (err) {
        console.warn("[dashboard] Failed to restore hardware freshness from localStorage:", err);
    }
}

function saveHwFreshnessToStorage() {
    try {
        localStorage.setItem(HW_FRESHNESS_STORAGE_KEY, JSON.stringify({
            lastChangeAt: hwLastChangeAt,
            lastSignature: hwLastSignature
        }));
    } catch (err) {
        console.warn("[dashboard] Failed to persist hardware freshness to localStorage:", err);
    }
}

// Signature of the six statistics.* values normalizeAquaponicsReading extracts.
// Lets a cold-load onSnapshot re-serving the same old doc be told apart from a
// genuine new write. Only used while measuredAt is absent — self-obsoletes
// once firmware starts writing it (see the branch in initHardwareStatusMonitor).
function buildHwSignature(data) {
    return JSON.stringify([
        data.phLevel, data.waterTemp, data.dissolvedOxygen,
        data.tds, data.salinity, data.turbidity, data.waterLevel
    ]);
}

function formatUpdatedAgo(ageMs) {
    if (ageMs == null || !Number.isFinite(ageMs)) {
        return "Last updated —";
    }
    const sec = Math.floor(ageMs / 1000);
    if (sec < 60) return `Last updated ${Math.max(0, sec)}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `Last updated ${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `Last updated ${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `Last updated ${days}d ago`;
}

function evaluateHardwareFreshness(measuredAtDate) {
    if (!measuredAtDate) {
        return { state: "offline", label: "Offline", updatedText: "Last updated —" };
    }

    const measuredTime = measuredAtDate.getTime();
    if (!Number.isFinite(measuredTime)) {
        return { state: "offline", label: "Offline", updatedText: "Last updated —" };
    }

    const ageMs = Math.max(0, Date.now() - measuredTime);

    if (ageMs > HW_STALE_THRESHOLD_MS) {
        return { state: "offline", label: "Offline", updatedText: formatUpdatedAgo(ageMs) };
    }
    if (ageMs > HW_ONLINE_THRESHOLD_MS) {
        return { state: "stale", label: "Stale", updatedText: formatUpdatedAgo(ageMs) };
    }
    return { state: "online", label: "Online", updatedText: formatUpdatedAgo(ageMs) };
}

function renderHardwareStatus(measuredAtDate) {
    const valueEl   = document.getElementById("hardware-status-value");
    const iconEl    = document.getElementById("hardware-status-icon");
    const trendEl   = document.getElementById("hardware-status-trend");
    const updatedEl = document.getElementById("hardware-status-updated");

    if (!valueEl && !iconEl && !trendEl) return;

    const { state, label, updatedText } = evaluateHardwareFreshness(measuredAtDate);

    if (valueEl) valueEl.textContent = label;
    if (updatedEl) updatedEl.textContent = updatedText;

    if (iconEl) {
        iconEl.className = "card-icon status status--" + state;
        let iconHtml = '<i class="fa-solid fa-circle-check"></i>';
        if (state === "stale")   iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>';
        if (state === "offline") iconHtml = '<i class="fa-solid fa-circle-xmark"></i>';
        iconEl.innerHTML = iconHtml;
    }

    if (trendEl) {
        let trendClass = "card-trend positive";
        let trendIcon = "fa-circle-check";
        if (state === "stale") {
            trendClass = "card-trend warning";
            trendIcon = "fa-clock";
        } else if (state === "offline") {
            trendClass = "card-trend negative";
            trendIcon = "fa-circle-exclamation";
        }
        trendEl.className = trendClass;

        const trendIconEl = document.getElementById("hardware-status-trend-icon");
        if (trendIconEl) {
            trendIconEl.className = "fa-solid " + trendIcon;
        }
    }

    // Full alert lifecycle for hardware_offline
    if (state === "offline") {
        createHardwareOfflineAlert();
    } else if (state === "online") {
        resolveHardwareOfflineAlert();
    }
}

let isCreatingHwAlert = false;
let isResolvingHwAlert = false;

async function findActiveHardwareAlert() {
    try {
        const snap = await getDocs(query(collection(db, "alerts"), where("status", "==", "active")));
        return snap.docs.find(d => d.data().type === "hardware_offline") || null;
    } catch (err) {
        console.warn("[dashboard] Failed to query active hardware alert:", err);
        return null;
    }
}

async function createHardwareOfflineAlert() {
    if (isCreatingHwAlert) return;
    isCreatingHwAlert = true;
    try {
        const existing = await findActiveHardwareAlert();
        if (existing) return; // Dedup: active hardware_offline alert already exists

        await addDoc(collection(db, "alerts"), {
            type:         "hardware_offline",
            parameter:    "hardware",
            currentValue: "Offline",
            safeRange:    "Online",
            message:      "Hardware offline — no sensor data received for >5 minutes.",
            severity:     "critical",
            status:       "active",
            createdAt:    serverTimestamp(),
            deviceId:     "ESP32-001"
        });
        console.log("[dashboard] Hardware offline alert created.");
    } catch (err) {
        console.error("[dashboard] Failed to create hardware offline alert:", err);
    } finally {
        isCreatingHwAlert = false;
    }
}

async function resolveHardwareOfflineAlert() {
    if (isResolvingHwAlert) return;
    isResolvingHwAlert = true;
    try {
        const activeAlert = await findActiveHardwareAlert();
        if (activeAlert) {
            await updateDoc(activeAlert.ref, {
                status:       "resolved",
                resolvedAt:   serverTimestamp(),
                currentValue: "Online"
            });
            console.log("[dashboard] Hardware offline alert auto-resolved.");
        }
    } catch (err) {
        console.error("[dashboard] Failed to resolve hardware alert:", err);
    } finally {
        isResolvingHwAlert = false;
    }
}

function initHardwareStatusMonitor() {
    if (hardwareTimer) {
        clearInterval(hardwareTimer);
        hardwareTimer = null;
    }

    loadHwFreshnessFromStorage();

    // Periodic timer to re-evaluate age even when no new readings arrive (e.g. hardware freeze/disconnect)
    hardwareTimer = setInterval(() => {
        renderHardwareStatus(latestHardwareMeasuredAt);
    }, HW_CHECK_INTERVAL_MS);

    // Initial render with null until snapshot fires
    renderHardwareStatus(null);

    // Single onSnapshot listener on Aquaponics/Ulang doc
    const unsubscribe = onSnapshot(
        AQUAPONICS_REF,
        (snapshot) => {
            if (!snapshot.exists()) {
                latestHardwareMeasuredAt = null;
                renderHardwareStatus(null);
                return;
            }

            const data = normalizeAquaponicsReading(snapshot.data());
            window.latestSensorReading = data;

            // Prioritize explicit measuredAt from the document once firmware writes
            // it — authoritative, no signature diffing needed.
            const parsedMeasuredAt = toDateValue(data.measuredAt);
            if (parsedMeasuredAt) {
                latestHardwareMeasuredAt = parsedMeasuredAt;
            } else {
                const signature = buildHwSignature(data);
                if (hwLastChangeAt == null || hwLastSignature == null) {
                    // First ever load, or storage was cleared — seed now instead of
                    // falling through to new Date(null)/epoch. Self-corrects to
                    // Offline within the stale threshold if actually down.
                    hwLastChangeAt = Date.now();
                    hwLastSignature = signature;
                    saveHwFreshnessToStorage();
                } else if (signature !== hwLastSignature) {
                    hwLastChangeAt = Date.now();
                    hwLastSignature = signature;
                    saveHwFreshnessToStorage();
                }
                // else: same data as last seen (cold-load re-serve or genuinely idle) —
                // keep the persisted lastChangeAt so age reflects the real last change.
                latestHardwareMeasuredAt = new Date(hwLastChangeAt);
            }
            renderHardwareStatus(latestHardwareMeasuredAt);
        },
        (error) => {
            console.warn("[dashboard] Aquaponics/Ulang hardware listener error:", error);
            latestHardwareMeasuredAt = null;
            renderHardwareStatus(null);
        }
    );

    return unsubscribe;
}

// Panelist requirement: yield prediction only after 3 months of real cultivation data
const RF_GATE_DAYS = 90;

function setTotalYieldValue(value) {
    const totalYieldValue = document.getElementById("total-yield-value");
    if (totalYieldValue && value) {
        totalYieldValue.textContent = String(value);
    }
}

async function loadTotalYieldExpected() {
    try {
        const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
        if (snap.empty) return;

        const data = snap.docs[0].data();

        // Same panelist gate as yieldPrediction.js: no yield number until the
        // cycle is RF_GATE_DAYS old. Checked before the rfProjectedYield
        // lookup so a stale value can't slip through. Missing cycleStart
        // fails closed (shown as "--").
        const cycleStart = toDateValue(data.cycleStart);
        const daysSinceCycleStart = cycleStart
            ? (Date.now() - cycleStart.getTime()) / (24 * 60 * 60 * 1000)
            : null;
        const eligible = daysSinceCycleStart != null && daysSinceCycleStart >= RF_GATE_DAYS;

        if (!eligible) {
            if (daysSinceCycleStart == null) {
                setTotalYieldValue("--");
            } else {
                const weeksRemaining = Math.ceil((RF_GATE_DAYS - daysSinceCycleStart) / 7);
                setTotalYieldValue(`Available in ${weeksRemaining} week${weeksRemaining === 1 ? "" : "s"}`);
            }
            return;
        }

        const rfProjectedYield = Number(data.rfProjectedYield);
        const rfAvailable      = Number.isFinite(rfProjectedYield) && rfProjectedYield > 0;

        // No formula fallback anymore — RF is the only yield source. If it
        // hasn't produced a usable prediction for this (eligible) cycle yet,
        // show a processing state rather than a number.
        if (!rfAvailable) {
            setTotalYieldValue("Processing");
            return;
        }

        setTotalYieldValue(rfProjectedYield.toFixed(1) + " kg");
    } catch (err) {
        console.warn("dashboard: unable to load growth_indicators for total yield expected:", err);
    }
}

function setActiveAlertsValue(count) {
    const activeAlertsValue = document.getElementById("active-alerts-value");
    const activeAlertsTrend = document.getElementById("active-alerts-trend");

    if (activeAlertsValue) {
        activeAlertsValue.textContent = String(count);
    }

    if (activeAlertsTrend) {
        activeAlertsTrend.innerHTML = count > 0
            ? '<i class="fa-solid fa-arrow-up"></i> Action required'
            : '<i class="fa-solid fa-check"></i> No active alerts';
    }
}

function createLogItem(entry) {
    const item = document.createElement("li");
    item.className = "log-item";

    const dot = document.createElement("span");
    dot.className = entry.type === "alert" || entry.type === "warning" ? "log-dot alert" : "log-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "log-title";
    title.textContent = entry.title;

    const meta = document.createElement("div");
    meta.className = "log-meta";

    const time = document.createElement("div");
    time.className = "log-time";
    time.textContent = entry.timeText;

    const actor = document.createElement("div");
    actor.className = "log-actor";
    actor.textContent = entry.actor;

    meta.appendChild(time);
    meta.appendChild(actor);

    const description = document.createElement("span");
    description.className = "log-desc";
    description.textContent = entry.description;

    item.appendChild(dot);
    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(description);

    return item;
}

function renderRecentLogs(entries) {
    const recentLogsList = document.getElementById("recent-logs-list");
    if (!recentLogsList) return;

    recentLogsList.innerHTML = "";

    if (!entries.length) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "log-item";
        emptyItem.textContent = "No recent logs found.";
        recentLogsList.appendChild(emptyItem);
        return;
    }

    entries.forEach((entry) => {
        recentLogsList.appendChild(createLogItem(entry));
    });
}

function applyActiveAlertsSnapshot(snapshot) {
    // Exclude alerts already handled via Assign Actions (handledAt set,
    // status still "active").
    const count = snapshot.docs.filter(d => d.data().handledAt == null).length;
    setActiveAlertsValue(count);
}

function applyRecentLogsSnapshot(snapshot) {
    const logDocs = snapshot.docs;
    if (!logDocs.length) {
        renderRecentLogs([]);
        return;
    }

    const normalizedLogs = logDocs
        .map((doc, index) => {
            const data = doc.data();
            const loggedAt = toDateValue(data.createdAt || data.timestamp || data.loggedAt || data.date);

            return {
                sortValue: loggedAt ? loggedAt.getTime() : index,
                title: getTextField(data, ["action", "title", "event", "name"], doc.id),
                timeText: getTextField(data, ["timeText", "time"], formatLogTime(loggedAt)),
                actor: getTextField(data, ["role", "actor", "user", "source", "by", "createdByName", "createdByEmail"], "System"),
                description: getTextField(data, ["details", "description", "message"], "No details provided."),
                type: getTextField(data, ["status", "type", "level"], "").toLowerCase()
            };
        })
        .sort((a, b) => b.sortValue - a.sortValue);

    renderRecentLogs(normalizedLogs);
}

async function loadData() {
    const [alertsResult, logsResult] = await Promise.allSettled([
        getDocs(query(collection(db, "alerts"), where("status", "==", "active"))),
        getDocs(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(5)))
    ]);

    if (alertsResult.status === "fulfilled") {
        applyActiveAlertsSnapshot(alertsResult.value);
    } else {
        console.warn("Unable to load active alerts from alerts collection.", alertsResult.reason);
    }

    if (logsResult.status === "fulfilled") {
        applyRecentLogsSnapshot(logsResult.value);
    } else {
        console.warn("Unable to load logs collection.", logsResult.reason);
    }
}

// ── growth_indicators cycleStart (one-shot, mirrors yieldPrediction.js) ────

async function loadCycleStartMs() {
    try {
        const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
        if (snap.empty) return null;

        const cycleStart = toDateValue(snap.docs[0].data().cycleStart);
        return cycleStart ? cycleStart.getTime() : null;
    } catch (err) {
        console.warn("dashboard: unable to load growth_indicators for cycleStart:", err);
        return null;
    }
}

// ── Current Mortality (mortality_records, actual logged deaths) ────────────

async function loadMortalityStat() {
    const rateEl = document.getElementById("mortalityRateValue");
    const countEl = document.getElementById("mortalitySurvivingCount");
    if (!rateEl && !countEl) return;

    try {
        const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
        if (snap.empty) return;

        const data = snap.docs[0].data();
        const initialStock = Number(data.initialStock);
        const cycleStart   = toDateValue(data.cycleStart);

        if (!Number.isFinite(initialStock) || initialStock <= 0 || !cycleStart) return;

        const deathsSnap = await getDocs(
            query(collection(db, "mortality_records"), where("createdAt", ">=", Timestamp.fromDate(cycleStart)))
        );

        let totalDeaths = 0;
        deathsSnap.forEach(docSnap => {
            totalDeaths += Number(docSnap.data().deathCount) || 0;
        });

        // Mirrors survivalChart.js's own clamp (Math.max(0, ...)) so mortality
        // can't exceed 100% if logged deaths somehow outnumber initialStock —
        // same edge case, same fix, applied from the mortality side.
        const survivalPct    = Math.max(0, ((initialStock - totalDeaths) / initialStock) * 100);
        const mortalityRate  = 100 - survivalPct;
        const confirmedAlive = Math.max(0, Math.round(initialStock - totalDeaths));

        if (rateEl) rateEl.textContent = mortalityRate.toFixed(1) + "%";
        if (countEl) countEl.textContent = `${confirmedAlive} confirmed alive of ${initialStock} stocked`;
    } catch (err) {
        console.warn("dashboard: unable to compute mortality rate from mortality_records:", err);
    }
}

(function() {
    function init() {
        var container = document.querySelector('.topbar');
        if (!container) return;
        var notifDropdown = container.querySelector('.notification-dropdown');
        var profileDropdown =   container.querySelector('.profile-dropdown');
        var notifBtn = container.querySelector('.notification-icon');
        var profileBtn = container.querySelector('.admin-profile');
        if (notifBtn && notifDropdown) {
            notifBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                notifDropdown.classList.toggle('show');
                if (profileDropdown) profileDropdown.classList.remove('show');
            });
        }
        if (profileBtn && profileDropdown) {
            profileBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                profileDropdown.classList.toggle('show');
                if (notifDropdown) notifDropdown.classList.remove('show');
            });
        }
        document.addEventListener('click', function(e) {
            if (container.contains(e.target)) return;
            if (notifDropdown) notifDropdown.classList.remove('show');
            if (profileDropdown) profileDropdown.classList.remove('show');
        });
        var logoutMenuItem = document.getElementById('logoutMenuItem');
        if (logoutMenuItem) {
            logoutMenuItem.addEventListener('click', function() {
                handleLogout(logoutMenuItem, profileDropdown);
            });
        }

        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        var menuBtn = document.getElementById('topbarMenuBtn');
        var app = document.querySelector('.app');
        if (sidebar && overlay && menuBtn) {
            menuBtn.addEventListener('click', function() {
                sidebar.classList.add('open');
                overlay.classList.add('show');
                overlay.setAttribute('aria-hidden', 'false');
            });
            overlay.addEventListener('click', function() {
                sidebar.classList.remove('open');
                overlay.classList.remove('show');
                overlay.setAttribute('aria-hidden', 'true');
            });
        }

        /* Sidebar collapse/toggle, persistence and click-to-collapse. */
        initSidebar();

        /* Generate Report modal – useful data in tables */
        var reportOverlay = document.getElementById('reportModalOverlay');
        var reportModal = document.getElementById('reportModal');
        var reportTableContainer = document.getElementById('reportTableContainer');
        var reportMetaEl = document.getElementById('reportMeta');
        var generateReportBtn = document.getElementById('generateReportBtn');
        var reportModalClose = document.getElementById('reportModalClose');
        var reportModalCancel = document.getElementById('reportModalCancel');
        var reportPrintPdf = document.getElementById('reportPrintPdf');

        function buildReportTable() {
            var dateStr = new Date().toLocaleDateString('en-PH', {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            if (reportMetaEl) reportMetaEl.textContent = 'Bantay Ulang Bulacan — Generated ' + dateStr;

            var html = '';

            html += '<div class="report-table-wrap">';
            html += '<div class="report-section-title">Key metrics</div>';
            html += '<table class="report-table"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>';
            html += '<tr><td>Total Yield Expected</td><td>55 kg</td></tr>';
            html += '<tr><td>Average Mortality Rate (Throughout the Week)</td><td>3.4%</td></tr>';
            html += '<tr><td>Estimated Harvest Date</td><td>Mar 15, 2026</td></tr>';
            html += '<tr><td>Mortality Risk</td><td>Low</td></tr>';
            html += '</tbody></table></div>';

            html += '<div class="report-table-wrap">';
            html += '<div class="report-section-title">Logged Water Parameters Data</div>';
            html += '<table class="report-table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Logged At</th></tr></thead><tbody>';
            html += '<tr><td>pH</td><td>7.2</td><td>—</td><td>Today, 10:30 AM</td></tr>';
            html += '<tr><td>Temperature</td><td>28</td><td>°C</td><td>Today, 10:30 AM</td></tr>';
            html += '<tr><td>Dissolved Oxygen</td><td>6.5</td><td>mg/L</td><td>Today, 10:30 AM</td></tr>';
            html += '<tr><td>Salinity</td><td>15</td><td>ppt</td><td>Today, 10:30 AM</td></tr>';
            html += '<tr><td>Nitrate</td><td>2.1</td><td>mg/L</td><td>Today, 09:00 AM</td></tr>';
            html += '<tr><td>Ammonia</td><td>0.25</td><td>mg/L</td><td>Today, 09:00 AM</td></tr>';
            html += '</tbody></table></div>';

            html += '<div class="report-table-wrap">';
            html += '<div class="report-section-title">Logged Plant Sensors Data</div>';
            html += '<table class="report-table"><thead><tr><th>Sensor / Metric</th><th>Value</th><th>Unit</th><th>Logged At</th></tr></thead><tbody>';
            html += '<tr><td>Nitrogen Level</td><td>88</td><td>%</td><td>Today, 08:45 AM</td></tr>';
            html += '<tr><td>Plant Height (Section A)</td><td>42</td><td>cm</td><td>Today, 08:45 AM</td></tr>';
            html += '<tr><td>Leaf Condition Index</td><td>Good</td><td>—</td><td>Today, 08:45 AM</td></tr>';
            html += '<tr><td>Growth Stage</td><td>Vegetative</td><td>—</td><td>Today, 08:45 AM</td></tr>';
            html += '<tr><td>Water Filtration Contribution</td><td>92</td><td>%</td><td>Yesterday, 4:00 PM</td></tr>';
            html += '</tbody></table></div>';

            if (reportTableContainer) reportTableContainer.innerHTML = html;
        }

        function openReportModal() {
            buildReportTable();
            if (reportOverlay) {
                reportOverlay.classList.add('show');
                reportOverlay.setAttribute('aria-hidden', 'false');
            }
        }
        function closeReportModal() {
            if (reportOverlay) {
                reportOverlay.classList.remove('show');
                reportOverlay.setAttribute('aria-hidden', 'true');
            }
        }

        if (generateReportBtn) generateReportBtn.addEventListener('click', openReportModal);
        if (reportModalClose) reportModalClose.addEventListener('click', closeReportModal);
        if (reportModalCancel) reportModalCancel.addEventListener('click', closeReportModal);
        if (reportOverlay) reportOverlay.addEventListener('click', function(e) {
            if (e.target === reportOverlay) closeReportModal();
        });
        if (reportModal) reportModal.addEventListener('click', function(e) { e.stopPropagation(); });
        if (reportPrintPdf) reportPrintPdf.addEventListener('click', function() { window.print(); });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// ── Welcome message ───────────────────────────────────────────────────────

function loadWelcomeData() {
    const headingEl  = document.getElementById('welcome-heading');
    const datetimeEl = document.getElementById('welcome-datetime');

    function updateDatetime() {
        if (!datetimeEl) return;
        const now = new Date();
        const datePart = now.toLocaleDateString('en-PH', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        const timePart = now.toLocaleTimeString('en-PH', {
            hour: 'numeric', minute: '2-digit', hour12: true
        });
        datetimeEl.textContent = datePart + ' · ' + timePart;
    }

    updateDatetime();
    setInterval(updateDatetime, 60000);

    const unsub = onAuthStateChanged(auth, async function(user) {
        unsub();
        if (!user || !headingEl) return;
        try {
            var snap = await getDoc(doc(db, 'users', user.uid));
            var data = snap.exists() ? snap.data() : {};
            var name = data.fullName || user.displayName ||
                       (user.email ? user.email.split('@')[0] : 'there');
            headingEl.textContent = 'Welcome back, ' + name + '!';
        } catch (err) {
            console.warn('[dashboard] Could not load user name:', err);
        }
    });
}

// ── Most important active alert ───────────────────────────────────────────

var SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

var PARAM_LABELS = {
    phLevel: 'pH Level',
    waterTemp: 'Water Temperature',
    dissolvedOxygen: 'Dissolved Oxygen',
    salinity: 'Salinity',
    turbidity: 'Turbidity',
    waterLevel: 'Water Level',
    tds: 'TDS',
    hardware: 'System Hardware'
};

function renderAlertBanner(container, alertData, totalCount) {
    var sev        = alertData.severity || 'low';
    var paramLabel = PARAM_LABELS[alertData.parameter] || alertData.parameter || 'Parameter';
    var value      = alertData.currentValue != null ? alertData.currentValue : '—';
    var safeRange  = alertData.safeRange || '—';
    var message    = alertData.message   || '';
    var moreCount  = totalCount > 1 ? totalCount - 1 : 0;
    var moreHtml   = moreCount > 0
        ? '<span class="tab-meta-sep">·</span>' +
          '<span class="tab-more">' + moreCount + ' more active alert' + (moreCount > 1 ? 's' : '') + '</span>'
        : '';

    container.className = 'top-alert-banner top-alert-banner--' + sev;
    container.innerHTML =
        '<div class="tab-icon-wrap"><i class="fa-solid ' + iconForSev(sev) + '"></i></div>' +
        '<div class="tab-content">' +
            '<div class="tab-top-row">' +
                '<span class="tab-param-name">' + paramLabel + '</span>' +
                '<span class="tab-sev-badge tab-sev-badge--' + sev + '">' + sev.toUpperCase() + '</span>' +
            '</div>' +
            '<p class="tab-message">' + message + '</p>' +
            '<div class="tab-meta-row">' +
                '<span class="tab-meta-item">Current: <strong>' + value + '</strong></span>' +
                '<span class="tab-meta-sep">·</span>' +
                '<span class="tab-meta-item">Safe range: <strong>' + safeRange + '</strong></span>' +
                moreHtml +
            '</div>' +
        '</div>' +
        '<a href="all-alerts.html" class="tab-action-btn">View All Alerts →</a>';
}

function renderNoBanner(container) {
    container.className = 'top-alert-banner top-alert-banner--ok';
    container.innerHTML =
        '<div class="tab-icon-wrap"><i class="fa-solid fa-circle-check"></i></div>' +
        '<div class="tab-content">' +
            '<span class="tab-param-name">All parameters are within safe range 🌊</span>' +
        '</div>';
}

function iconForSev(sev) {
    if (sev === 'critical') return 'fa-triangle-exclamation';
    if (sev === 'high')     return 'fa-circle-exclamation';
    return 'fa-circle-info';
}

async function loadTopAlert() {
    var bannerEl = document.getElementById('top-alert-banner');
    if (!bannerEl) return;
    try {
        var snap = await getDocs(
            query(collection(db, 'alerts'), where('status', '==', 'active'))
        );

        // Exclude alerts already handled via Assign Actions (handledAt set,
        // status still "active") so the banner matches the Active Alerts card.
        var unhandled = snap.docs.filter(function (d) { return d.data().handledAt == null; });
        if (!unhandled.length) { renderNoBanner(bannerEl); return; }

        var topData = null;
        var topRank = -1;
        var topTime = 0;

        unhandled.forEach(function(d) {
            var data = d.data();
            var rank = SEVERITY_RANK[data.severity] || 0;
            var t    = (data.createdAt && data.createdAt.seconds) ? data.createdAt.seconds : 0;
            if (rank > topRank || (rank === topRank && t > topTime)) {
                topRank = rank;
                topData = data;
                topTime = t;
            }
        });

        if (topData) {
            renderAlertBanner(bannerEl, topData, unhandled.length);
        } else {
            renderNoBanner(bannerEl);
        }
    } catch (err) {
        console.warn('[dashboard] Could not load top alert:', err);
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    await reevaluateActiveAlerts();
    initHardwareStatusMonitor();
    loadWelcomeData();
    loadTopAlert();
    loadMortalityStat();
    loadTotalYieldExpected();
    await loadData();

    var envCtx = document.getElementById('envTrendsChart');
    var envLoadingEl = document.getElementById('envTrendsLoading');
    var paramDropdown = document.getElementById('envTrendsParamDropdown');
    var rangeDropdown = document.getElementById('envTrendsRangeDropdown');

    if (envCtx) {
        var envTrendsChart = initEnvTrendsChart(envCtx);

        var cycleStartMs = null;
        try {
            var loaded = await Promise.all([loadCycleStartMs(), loadThresholds()]);
            cycleStartMs = loaded[0];
        } catch (err) {
            console.warn('dashboard: env trends init (cycleStart/thresholds) failed:', err);
        }

        var refreshEnvTrends = function() {
            var paramKey = paramDropdown ? paramDropdown.value : 'ph';
            var rangeKey = rangeDropdown ? rangeDropdown.value : '24h';
            return refreshEnvTrendsChart(envTrendsChart, paramKey, rangeKey, cycleStartMs);
        };

        if (paramDropdown) paramDropdown.addEventListener('change', refreshEnvTrends);
        if (rangeDropdown) rangeDropdown.addEventListener('change', refreshEnvTrends);

        // Only the very first load can hit the cold-cache catch-up path
        // (catchUpCache inside refreshEnvTrendsChart) — show the overlay for
        // that call only, not on every later dropdown change.
        if (envLoadingEl) envLoadingEl.classList.remove('chart-hidden');
        await refreshEnvTrends();
        if (envLoadingEl) envLoadingEl.classList.add('chart-hidden');
    }
});
