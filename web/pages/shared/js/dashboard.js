import { auth, db } from "./firebase.js";
import { collection, doc, getDocs, getDoc, limit, orderBy, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getReadingsInRange } from "./readingsService.js";
import { loadThresholds, getRanges } from "./thresholds.js";

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
    setActiveAlertsValue(snapshot.size);
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

// ── Environmental Trends (readingsService) ──────────────────────────────────

const ENV_PARAM_CONFIG = {
    ph:              { label: "pH",                       yMin: 6.5, yMax: 8.5, color: "#2563eb" },
    dissolvedOxygen: { label: "Dissolved Oxygen (mg/L)",   yMin: 5,   yMax: 9,   color: "#0891b2" },
    waterTemp:       { label: "Temperature (°C)",          yMin: 20,  yMax: 32,  color: "#dc2626" },
    salinity:        { label: "Salinity (ppt)",            yMin: 0,   yMax: 18,  color: "#7c3aed" },
    turbidity:       { label: "Turbidity (NTU)",           yMin: 0,   yMax: 25,  color: "#b45309" },
    tds:             { label: "TDS (ppm)",                 color: "#0d9488" }
};

const ENV_RANGE_CONFIG = {
    "24h": { ms: 24 * 60 * 60 * 1000,      label: "Last 24 Hours" },
    "7d":  { ms: 7  * 24 * 60 * 60 * 1000, label: "Last 7 Days" },
    "30d": { ms: 30 * 24 * 60 * 60 * 1000, label: "Last 30 Days" }
};

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

function formatEnvLabel(date, rangeKey) {
    if (rangeKey === "24h") {
        return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchEnvTrends(paramKey, rangeKey, cycleStartMs) {
    const now = Date.now();
    const cutoff = now - ENV_RANGE_CONFIG[rangeKey].ms;
    const readings = await getReadingsInRange(cycleStartMs, cutoff, now);

    return readings
        .map((reading) => {
            const value = reading[paramKey];
            if (typeof value !== "number" || !Number.isFinite(value)) return null;
            return { label: formatEnvLabel(new Date(reading.measuredAtMs), rangeKey), value };
        })
        .filter(Boolean);
}

function envFallbackRange(paramKey, config) {
    if (paramKey !== "tds") return { min: config.yMin, max: config.yMax };

    const tdsRange = getRanges().tds;
    const hasBoth = tdsRange && tdsRange.min != null && tdsRange.max != null;
    return hasBoth ? { min: tdsRange.min, max: tdsRange.max } : { min: undefined, max: undefined };
}

async function updateEnvTrendsChart(chart, paramDropdown, rangeDropdown, cycleStartMs) {
    if (!chart) return;

    const paramKey = paramDropdown ? paramDropdown.value : "ph";
    const rangeKey = rangeDropdown ? rangeDropdown.value : "24h";
    const config = ENV_PARAM_CONFIG[paramKey] || ENV_PARAM_CONFIG.ph;

    try {
        const points = await fetchEnvTrends(paramKey, rangeKey, cycleStartMs);
        const labels = points.map((point) => point.label);
        const values = points.map((point) => point.value);
        const fallback = envFallbackRange(paramKey, config);
        const range = computeRange(values, fallback.min, fallback.max);

        chart.data.labels = labels;
        chart.data.datasets[0].label = config.label;
        chart.data.datasets[0].data = values;
        chart.data.datasets[0].borderColor = config.color;
        chart.data.datasets[0].backgroundColor = config.color + "1a";
        chart.options.scales.y.min = range.min;
        chart.options.scales.y.max = range.max;
        chart.update();
    } catch (err) {
        console.warn("dashboard: unable to load environmental trends:", err);
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
    waterLevel: 'Water Level'
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
        '<a href="real-time-monitoring.html" class="tab-action-btn">View All Alerts →</a>';
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
        if (snap.empty) { renderNoBanner(bannerEl); return; }

        var topData = null;
        var topRank = -1;
        var topTime = 0;

        snap.docs.forEach(function(d) {
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
            renderAlertBanner(bannerEl, topData, snap.size);
        } else {
            renderNoBanner(bannerEl);
        }
    } catch (err) {
        console.warn('[dashboard] Could not load top alert:', err);
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    loadWelcomeData();
    loadTopAlert();
    loadMortalityStat();
    loadTotalYieldExpected();
    await loadData();

    var envCtx = document.getElementById('envTrendsChart');
    var paramDropdown = document.getElementById('envTrendsParamDropdown');
    var rangeDropdown = document.getElementById('envTrendsRangeDropdown');
    var envTrendsChart = null;

    if (envCtx) {
        envTrendsChart = new Chart(envCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '',
                    data: [],
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
                    y: { beginAtZero: false, grid: { color: '#f3f4f6' } },
                    x: { grid: { display: false } }
                }
            }
        });

        var cycleStartMs = null;
        try {
            var loaded = await Promise.all([loadCycleStartMs(), loadThresholds()]);
            cycleStartMs = loaded[0];
        } catch (err) {
            console.warn('dashboard: env trends init (cycleStart/thresholds) failed:', err);
        }

        var refreshEnvTrends = function() {
            updateEnvTrendsChart(envTrendsChart, paramDropdown, rangeDropdown, cycleStartMs);
        };

        if (paramDropdown) paramDropdown.addEventListener('change', refreshEnvTrends);
        if (rangeDropdown) rangeDropdown.addEventListener('change', refreshEnvTrends);

        refreshEnvTrends();
    }
});
