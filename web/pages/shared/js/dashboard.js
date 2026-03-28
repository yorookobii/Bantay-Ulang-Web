import { auth, db } from "./firebase.js";
import { collection, getDocs, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const defaultEnvLabels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"];
const defaultEnvParamData = {
    ph:       { label: "pH", data: [7.0, 7.1, 7.2, 7.3, 7.2, 7.1, 7.2], yMin: 6.5, yMax: 8 },
    do:       { label: "Dissolved Oxygen (mg/L)", data: [6.2, 6.4, 6.8, 6.5, 6.6, 6.4, 6.3], yMin: 5, yMax: 9 },
    temp:     { label: "Temperature (°C)", data: [23, 23.5, 24, 25, 26, 25.5, 24.5], yMin: 20, yMax: 30 },
    salinity: { label: "Salinity (ppt)", data: [14, 14.5, 15, 15, 15.2, 15, 14.8], yMin: 12, yMax: 18 },
    turbidity:{ label: "Turbidity (NTU)", data: [3.2, 3.0, 3.5, 3.8, 3.6, 3.4, 3.3], yMin: 2, yMax: 6 },
    nitrate:  { label: "Nitrate (ppm)", data: [4, 5, 5.5, 6, 5, 4.5, 4], yMin: 0, yMax: 20 }
};
const defaultMortalityLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const defaultMortalityValues = [3.2, 3.5, 3.1, 3.8, 3.4, 3.2, 3.6];
const dayOrder = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

let envTrendLabels = [...defaultEnvLabels];
let envParamData = cloneEnvParamData(defaultEnvParamData);
let mortalityLabels = [...defaultMortalityLabels];
let mortalityValues = [...defaultMortalityValues];

const AUTH_SESSION_KEY = "bantay-ulang-auth-user";
const LOGIN_PAGE = "../security/admin-tech-login.html";

function syncDashboardFirestoreState() {
    window.dashboardFirestoreState = {
        envTrendLabels: [...envTrendLabels],
        envParamData: cloneEnvParamData(envParamData),
        mortalityLabels: [...mortalityLabels],
        mortalityValues: [...mortalityValues]
    };
}

syncDashboardFirestoreState();

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

function cloneEnvParamData(source) {
    return Object.fromEntries(
        Object.entries(source).map(([key, value]) => [key, { ...value, data: [...value.data] }])
    );
}

function getNumberField(data, keys) {
    for (const key of keys) {
        const value = data?.[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }

    return null;
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

function formatTimeLabel(value, fallback) {
    const date = toDateValue(value);
    if (!date) return fallback;

    return date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}

function formatLogTime(value, fallback = "Just now") {
    const date = toDateValue(value);
    if (!date) return fallback;

    return date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function computeRange(values, fallbackMin, fallbackMax) {
    const numericValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!numericValues.length) return { min: fallbackMin, max: fallbackMax };

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    if (min === max) {
        const pad = Math.max(Math.abs(min) * 0.15, 0.5);
        return { min: min - pad, max: max + pad };
    }

    const pad = Math.max((max - min) * 0.15, 0.5);
    return { min: min - pad, max: max + pad };
}

function setTotalYieldValue(value) {
    const totalYieldValue = document.getElementById("total-yield-value");
    if (totalYieldValue && value) {
        totalYieldValue.textContent = String(value);
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

function setMortalityBadge(values) {
    const mortalityBadge = document.getElementById("mortality-average-badge");
    const numericValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!mortalityBadge || !numericValues.length) return;

    const average = numericValues.reduce((total, value) => total + value, 0) / numericValues.length;
    mortalityBadge.textContent = average.toFixed(1) + "% Weekly Average";
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

function applyTotalYieldSnapshot(snapshot) {
    snapshot.forEach((doc) => {
        const data = doc.data();
        const totalYield = getTextField(data, ["message", "totalYield", "yield", "value"], "");
        console.log("Yield ID:", doc.id);
        console.log("Yield Data:", data);

        if (totalYield) {
            setTotalYieldValue(totalYield);
        }
    });
}

function applyActiveAlertsSnapshot(snapshot) {
    setActiveAlertsValue(snapshot.size);
}

function applyEnvironmentSnapshot(snapshot) {
    const envDocs = snapshot.docs;
    if (!envDocs.length) return;

    if (envDocs.length === 1) {
        const singleDoc = envDocs[0].data();
        const labels = Array.isArray(singleDoc.labels)
            ? singleDoc.labels.map((label, index) => String(label || index + 1))
            : null;

        if (labels) {
            const nextEnvParamData = cloneEnvParamData(defaultEnvParamData);
            let hasSeries = false;

            Object.entries(defaultEnvParamData).forEach(([key, config]) => {
                const seriesSource = Array.isArray(singleDoc[key])
                    ? singleDoc[key]
                    : key === "do" && Array.isArray(singleDoc.dissolvedOxygen)
                        ? singleDoc.dissolvedOxygen
                        : key === "temp" && Array.isArray(singleDoc.temperature)
                            ? singleDoc.temperature
                            : null;

                if (!seriesSource) return;

                const series = seriesSource.map((value) => {
                    if (typeof value === "number" && Number.isFinite(value)) return value;
                    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
                        return Number(value);
                    }
                    return null;
                });

                if (series.some((value) => value !== null)) {
                    const range = computeRange(series, config.yMin, config.yMax);
                    nextEnvParamData[key].data = series;
                    nextEnvParamData[key].yMin = range.min;
                    nextEnvParamData[key].yMax = range.max;
                    hasSeries = true;
                }
            });

            if (hasSeries) {
                envTrendLabels = labels;
                envParamData = nextEnvParamData;
                syncDashboardFirestoreState();
                return;
            }
        }
    }

    const trendPoints = envDocs
        .map((doc, index) => {
            const data = doc.data();
            const loggedAt = toDateValue(data.timestamp || data.loggedAt || data.createdAt || data.date);

            return {
                sortValue: loggedAt ? loggedAt.getTime() : index,
                label: getTextField(data, ["label", "timeLabel"], formatTimeLabel(loggedAt, doc.id)),
                ph: getNumberField(data, ["ph"]),
                do: getNumberField(data, ["do", "dissolvedOxygen", "dissolved_oxygen"]),
                temp: getNumberField(data, ["temp", "temperature"]),
                salinity: getNumberField(data, ["salinity"]),
                turbidity: getNumberField(data, ["turbidity"]),
                nitrate: getNumberField(data, ["nitrate"])
            };
        })
        .sort((a, b) => a.sortValue - b.sortValue);

    if (!trendPoints.length) return;

    const nextEnvParamData = cloneEnvParamData(defaultEnvParamData);
    envTrendLabels = trendPoints.map((point, index) => point.label || ("Point " + (index + 1)));

    Object.entries(defaultEnvParamData).forEach(([key, config]) => {
        const series = trendPoints.map((point) => (typeof point[key] === "number" ? point[key] : null));
        if (!series.some((value) => value !== null)) return;

        const range = computeRange(series, config.yMin, config.yMax);
        nextEnvParamData[key].data = series;
        nextEnvParamData[key].yMin = range.min;
        nextEnvParamData[key].yMax = range.max;
    });

    envParamData = nextEnvParamData;
    syncDashboardFirestoreState();
}

function applyMortalitySnapshot(snapshot) {
    const mortalityDocs = snapshot.docs;
    if (!mortalityDocs.length) return;

    if (mortalityDocs.length === 1) {
        const singleDoc = mortalityDocs[0].data();
        const labels = Array.isArray(singleDoc.labels)
            ? singleDoc.labels
            : Array.isArray(singleDoc.days)
                ? singleDoc.days
                : null;
        const values = Array.isArray(singleDoc.values)
            ? singleDoc.values
            : Array.isArray(singleDoc.data)
                ? singleDoc.data
                : Array.isArray(singleDoc.rates)
                    ? singleDoc.rates
                    : null;

        if (labels && values) {
            mortalityLabels = labels.map((label, index) => String(label || index + 1));
            mortalityValues = values.map((value) => {
                if (typeof value === "number" && Number.isFinite(value)) return value;
                if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
                    return Number(value);
                }
                return 0;
            });
            setMortalityBadge(mortalityValues);
            syncDashboardFirestoreState();
            return;
        }
    }

    const mortalityPoints = mortalityDocs
        .map((doc, index) => {
            const data = doc.data();
            const loggedAt = toDateValue(data.timestamp || data.loggedAt || data.createdAt || data.date);
            const label = getTextField(data, ["label", "day"], doc.id);
            const shortLabel = label.slice(0, 3);

            return {
                sortValue: loggedAt ? loggedAt.getTime() : (dayOrder[shortLabel] ?? index),
                label: shortLabel,
                value: getNumberField(data, ["value", "rate", "mortality", "mortalityRate", "percentage", "percent"])
            };
        })
        .filter((point) => point.value !== null)
        .sort((a, b) => a.sortValue - b.sortValue);

    if (!mortalityPoints.length) return;

    mortalityLabels = mortalityPoints.map((point) => point.label);
    mortalityValues = mortalityPoints.map((point) => point.value);
    setMortalityBadge(mortalityValues);
    syncDashboardFirestoreState();
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
                actor: getTextField(data, ["role", "actor", "user", "source", "by"], "System"),
                description: getTextField(data, ["details", "description", "message"], "No details provided."),
                type: getTextField(data, ["status", "type", "level"], "").toLowerCase()
            };
        })
        .sort((a, b) => b.sortValue - a.sortValue);

    renderRecentLogs(normalizedLogs);
}

async function loadData() {
    const [yieldResult, alertsResult, envResult, mortalityResult, logsResult] = await Promise.allSettled([
        getDocs(collection(db, "test_connection")),
        getDocs(query(collection(db, "alerts"), where("status", "==", "active"))),
        getDocs(collection(db, "environmental_trends")),
        getDocs(collection(db, "mortality_rates")),
        getDocs(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(5)))
    ]);

    if (yieldResult.status === "fulfilled") {
        applyTotalYieldSnapshot(yieldResult.value);
    } else {
        console.warn("Unable to load test_connection collection.", yieldResult.reason);
    }

    if (alertsResult.status === "fulfilled") {
        applyActiveAlertsSnapshot(alertsResult.value);
    } else {
        console.warn("Unable to load active alerts from alerts collection.", alertsResult.reason);
    }

    if (envResult.status === "fulfilled") {
        applyEnvironmentSnapshot(envResult.value);
    } else {
        console.warn("Unable to load environmental_trends collection.", envResult.reason);
    }

    if (mortalityResult.status === "fulfilled") {
        applyMortalitySnapshot(mortalityResult.value);
    } else {
        console.warn("Unable to load mortality_rates collection.", mortalityResult.reason);
    }

    if (logsResult.status === "fulfilled") {
        applyRecentLogsSnapshot(logsResult.value);
    } else {
        console.warn("Unable to load logs collection.", logsResult.reason);
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

                    /* Sidebar toggle: collapse on desktop, close drawer on mobile */
                    var sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
                    if (sidebar && app && sidebarToggleBtn) {
                        function isMobile() { return window.innerWidth <= 768; }
                        function setCollapsed(collapsed) {
                            if (collapsed) {
                                sidebar.classList.add('collapsed');
                                app.classList.add('sidebar-collapsed');
                            } else {
                                sidebar.classList.remove('collapsed');
                                app.classList.remove('sidebar-collapsed');
                            }
                            try { localStorage.setItem('dashboard-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
                        }
                        sidebarToggleBtn.addEventListener('click', function() {
                            if (isMobile()) {
                                sidebar.classList.remove('open');
                                if (overlay) {
                                    overlay.classList.remove('show');
                                    overlay.setAttribute('aria-hidden', 'true');
                                }
                            } else {
                                var collapsed = !sidebar.classList.contains('collapsed');
                                setCollapsed(collapsed);
                                sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
                            }
                        });
                        /* Restore collapsed state on desktop */
                        if (!isMobile()) {
                            try {
                                var saved = localStorage.getItem('dashboard-sidebar-collapsed');
                                if (saved === '1') setCollapsed(true);
                                if (saved === '1') sidebarToggleBtn.setAttribute('aria-label', 'Expand sidebar');
                            } catch (e) {}
                        }
                    }

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

            document.addEventListener('DOMContentLoaded', async function() {
                await loadData();

                var envCtx = document.getElementById('envTrendsChart');
                var paramDropdown = document.getElementById('envTrendsParamDropdown');
                var envTrendsChart = null;

                var envParamData = {
                    ph:       { label: 'pH',           data: [7.0, 7.1, 7.2, 7.3, 7.2, 7.1, 7.2], yMin: 6.5, yMax: 8 },
                    do:       { label: 'Dissolved Oxygen (mg/L)', data: [6.2, 6.4, 6.8, 6.5, 6.6, 6.4, 6.3], yMin: 5, yMax: 9 },
                    temp:     { label: 'Temperature (°C)',        data: [23, 23.5, 24, 25, 26, 25.5, 24.5], yMin: 20, yMax: 30 },
                    salinity: { label: 'Salinity (ppt)',         data: [14, 14.5, 15, 15, 15.2, 15, 14.8], yMin: 12, yMax: 18 },
                    turbidity:{ label: 'Turbidity (NTU)',        data: [3.2, 3.0, 3.5, 3.8, 3.6, 3.4, 3.3], yMin: 2, yMax: 6 },
                    nitrate:  { label: 'Nitrate (ppm)',          data: [4, 5, 5.5, 6, 5, 4.5, 4], yMin: 0, yMax: 20 }
                };

                var dashboardFirestoreState = window.dashboardFirestoreState || {};
                envParamData = dashboardFirestoreState.envParamData || envParamData;
                var envLabels = dashboardFirestoreState.envTrendLabels || ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'];
                var mortalityChartLabels = dashboardFirestoreState.mortalityLabels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                var mortalityChartValues = dashboardFirestoreState.mortalityValues || [3.2, 3.5, 3.1, 3.8, 3.4, 3.2, 3.6];

                function getEnvParamKey() {
                    return paramDropdown ? paramDropdown.value : 'ph';
                }

                function updateEnvTrendsChart() {
                    var key = getEnvParamKey();
                    var cfg = envParamData[key] || envParamData.ph;
                    if (!envTrendsChart) return;
                    envTrendsChart.data.labels = envLabels;
                    envTrendsChart.data.datasets[0].label = cfg.label;
                    envTrendsChart.data.datasets[0].data = cfg.data;
                    envTrendsChart.options.scales.y.min = cfg.yMin;
                    envTrendsChart.options.scales.y.max = cfg.yMax;
                    envTrendsChart.update();
                }

                if (envCtx) {
                    var key = getEnvParamKey();
                    var cfg = envParamData[key] || envParamData.ph;
                    envTrendsChart = new Chart(envCtx.getContext('2d'), {
                        type: 'line',
                        data: {
                            labels: envLabels,
                            datasets: [{
                                label: cfg.label,
                                data: cfg.data,
                                borderColor: '#10b981',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: false, min: cfg.yMin, max: cfg.yMax, grid: { color: '#f3f4f6' } },
                                x: { grid: { display: false } }
                            }
                        }
                    });
                    if (paramDropdown) {
                        paramDropdown.addEventListener('change', updateEnvTrendsChart);
                    }
                }

                var mortCtx = document.getElementById('mortalityChart');
                if (mortCtx) {
                    new Chart(mortCtx.getContext('2d'), {
                        type: 'bar',
                        data: {
                            labels: mortalityChartLabels,
                            datasets: [{
                                label: 'Mortality %',
                                data: mortalityChartValues,
                                backgroundColor: 'rgba(239, 68, 68, 0.7)',
                                borderColor: '#dc2626',
                                borderWidth: 1
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, max: 6, grid: { color: '#f3f4f6' } },
                                x: { grid: { display: false } }
                            }
                        }
                    });
                }
                
            });



            
