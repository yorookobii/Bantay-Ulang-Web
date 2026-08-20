import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds, getRanges } from "./thresholds.js";
import { getReadingsInRange } from "./readingsService.js";

// Presentation-only config (chart color, display label/unit). Safe-range
// bounds and display text are derived live from the shared thresholds
// module — see buildSafeText() / getRanges() — not stored here.
const SENSOR_CONFIG = {
    "ph": {
        key: "ph",
        rangeKey: "phLevel",
        label: "pH Level",
        unit: "",
        color: "#2563eb"
    },
    "do": {
        key: "dissolvedOxygen",
        rangeKey: "dissolvedOxygen",
        label: "Dissolved Oxygen",
        unit: " mg/L",
        color: "#0891b2"
    },
    "temp": {
        key: "waterTemp",
        rangeKey: "waterTemp",
        label: "Water Temperature",
        unit: "°C",
        color: "#dc2626"
    },
    "salinity": {
        key: "salinity",
        rangeKey: "salinity",
        label: "Salinity",
        unit: " ppt",
        color: "#7c3aed"
    },
    "turbidity": {
        key: "turbidity",
        rangeKey: "turbidity",
        label: "Turbidity",
        unit: " NTU",
        color: "#b45309"
    },
    "tds": {
        key: "tds",
        rangeKey: "tds",
        label: "TDS",
        unit: " ppm",
        color: "#0d9488"
    }
};

// Builds this modal's own "Safe range: …" phrasing (distinct from
// thresholds.js's generic safeRangeStr) from a live { min, max } pair.
// Read-only — never writes back onto the range object it's given.
function buildSafeText(range, unit) {
    const hasMin = range.min != null;
    const hasMax = range.max != null;
    if (hasMin && hasMax) return `Safe range: ${range.min} – ${range.max}${unit}`;
    if (hasMin) return `Safe range: above ${range.min}${unit}`;
    if (hasMax) return `Safe range: below ${range.max}${unit}`;
    return "Safe range: —";
}

const RANGES = {
    "24h": { ms: 24 * 60 * 60 * 1000,       label: "Last 24 Hours" },
    "7d":  { ms: 7  * 24 * 60 * 60 * 1000,  label: "Last 7 Days"   },
    "30d": { ms: 30 * 24 * 60 * 60 * 1000,  label: "Last 30 Days"  }
};

// ── growth_indicators cycleStart (one-shot, mirrors dashboard.js) ──────────

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
        console.warn("sensorHistoryModal: unable to load growth_indicators for cycleStart:", err);
        return null;
    }
}

let cycleStartMsPromise = null;
function getCycleStartMs() {
    if (!cycleStartMsPromise) cycleStartMsPromise = loadCycleStartMs();
    return cycleStartMsPromise;
}

let chartInstance     = null;
let currentSensorAttr = null;
let currentRange      = "24h";

function formatLabel(date, rangeKey) {
    if (rangeKey === "24h") {
        return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("en-PH", {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}

async function fetchHistory(sensorKey, rangeKey, cycleStartMs) {
    const now = Date.now();
    const cutoff = now - RANGES[rangeKey].ms;
    const readings = await getReadingsInRange(cycleStartMs, cutoff, now);

    return readings
        .map(reading => {
            const val = reading[sensorKey];
            if (typeof val !== "number" || !Number.isFinite(val)) return null;
            return { time: new Date(reading.measuredAtMs), value: val };
        })
        .filter(Boolean);
}

function buildChart(canvas, config, points, rangeKey, range, safeText) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const labels = points.map(p => formatLabel(p.time, rangeKey));
    const values = points.map(p => p.value);

    const hasSafeRange = range.min != null || range.max != null;
    const datasets = [];

    if (hasSafeRange) {
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const pad     = Math.max((dataMax - dataMin) * 0.3, 0.5);

        const safeMinFill = range.min != null ? range.min : Math.max(0, dataMin - pad);
        const safeMaxFill = range.max != null ? range.max : dataMax + pad;

        datasets.push(
            {
                label: "__safeMin",
                data: labels.map(() => safeMinFill),
                borderColor: "transparent",
                backgroundColor: "transparent",
                pointRadius: 0,
                fill: false,
                tension: 0,
                order: 10
            },
            {
                label: "Safe Zone",
                data: labels.map(() => safeMaxFill),
                borderColor: "transparent",
                backgroundColor: "rgba(16, 185, 129, 0.18)",
                pointRadius: 0,
                fill: "-1",
                tension: 0,
                order: 9
            }
        );
    }

    datasets.push({
        label: config.label,
        data: values,
        borderColor: config.color,
        backgroundColor: config.color + "20",
        borderWidth: 2.5,
        pointRadius: points.length > 80 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: config.color,
        tension: 0.35,
        fill: false,
        order: 1
    });

    chartInstance = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        filter: item => item.text !== "__safeMin",
                        usePointStyle: true,
                        color: "#374151",
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: "#1f2937",
                    titleColor: "#f9fafb",
                    bodyColor: "#d1d5db",
                    callbacks: {
                        label: ctx => {
                            if (ctx.dataset.label === "__safeMin") return null;
                            if (ctx.dataset.label === "Safe Zone")
                                return "  " + safeText;
                            return `  ${config.label}: ${ctx.parsed.y}${config.unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        maxRotation: 30,
                        color: "#6b7280",
                        font: { size: 11 }
                    },
                    grid: { color: "rgba(0,0,0,0.05)" }
                },
                y: {
                    ticks: {
                        callback: val => val + config.unit,
                        color: "#6b7280",
                        font: { size: 11 }
                    },
                    grid: { color: "rgba(0,0,0,0.05)" }
                }
            }
        }
    });
}

async function loadAndRender(sensorAttr, rangeKey) {
    const config = SENSOR_CONFIG[sensorAttr];
    if (!config) return;

    await loadThresholds();
    const range    = getRanges()[config.rangeKey];
    const safeText = buildSafeText(range, config.unit);

    const canvas  = document.getElementById("shChart");
    const loading = document.getElementById("shLoadingState");
    const empty   = document.getElementById("shEmptyState");
    const safeEl  = document.getElementById("shSafeRangeText");

    if (canvas)  canvas.classList.add("sh-hidden");
    if (loading) loading.classList.remove("sh-hidden");
    if (empty)   empty.classList.add("sh-hidden");
    if (safeEl)  safeEl.textContent = safeText;

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    try {
        const cycleStartMs = await getCycleStartMs();
        const points = await fetchHistory(config.key, rangeKey, cycleStartMs);
        if (loading) loading.classList.add("sh-hidden");

        if (!points.length) {
            if (empty) empty.classList.remove("sh-hidden");
            return;
        }

        if (canvas) canvas.classList.remove("sh-hidden");
        buildChart(canvas, config, points, rangeKey, range, safeText);
    } catch (err) {
        console.error("sensorHistoryModal:", err);
        if (loading) loading.classList.add("sh-hidden");
        if (empty) {
            empty.textContent = "Failed to load sensor data.";
            empty.classList.remove("sh-hidden");
        }
    }
}

function openModal(sensorAttr) {
    const config = SENSOR_CONFIG[sensorAttr];
    if (!config) return;

    currentSensorAttr = sensorAttr;
    currentRange      = "24h";

    const overlay  = document.getElementById("sensorHistoryModal");
    const title    = document.getElementById("shModalTitle");
    const subtitle = document.getElementById("shModalSubtitle");

    if (title)    title.textContent    = config.label + " History";
    if (subtitle) subtitle.textContent = RANGES[currentRange].label;

    overlay.querySelectorAll(".sh-toggle-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.range === "24h");
    });

    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    loadAndRender(sensorAttr, currentRange);
}

function closeModal() {
    const overlay = document.getElementById("sensorHistoryModal");
    if (!overlay) return;
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

export function initSensorHistoryModal() {
    document.querySelectorAll(".sensor-card[data-sensor]").forEach(card => {
        if (!SENSOR_CONFIG[card.dataset.sensor]) return;

        const hint = document.createElement("div");
        hint.className = "sh-card-hint";
        hint.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
        hint.setAttribute("aria-hidden", "true");
        card.appendChild(hint);
        card.addEventListener("click", () => openModal(card.dataset.sensor));
    });

    const overlay = document.getElementById("sensorHistoryModal");
    if (overlay) {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) closeModal();
        });
    }

    const closeBtn = document.getElementById("shModalClose");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    document.querySelectorAll(".sh-toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentRange = btn.dataset.range;
            const subtitle = document.getElementById("shModalSubtitle");
            if (subtitle) subtitle.textContent = RANGES[currentRange].label;
            document.querySelectorAll(".sh-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            if (currentSensorAttr) loadAndRender(currentSensorAttr, currentRange);
        });
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            const o = document.getElementById("sensorHistoryModal");
            if (o && o.classList.contains("active")) closeModal();
        }
    });
}
