import { loadThresholds, getRanges } from "./thresholds.js";

// Presentation-only config (chart color, display label/unit). Safe-range
// bounds and display text are derived live from the shared thresholds
// module — see buildSafeText() / getRanges() — not stored here.
// liveKey is the field name used in the "sensor-reading-updated" event detail
// (see aquaponicsReading.js's normalizeAquaponicsReading) — NOT the old
// HistoryLogs field name, which differed for pH ("ph" vs "phLevel").
const SENSOR_CONFIG = {
    "ph": {
        liveKey: "phLevel",
        rangeKey: "phLevel",
        label: "pH Level",
        unit: "",
        color: "#2563eb"
    },
    "do": {
        liveKey: "dissolvedOxygen",
        rangeKey: "dissolvedOxygen",
        label: "Dissolved Oxygen",
        unit: " mg/L",
        color: "#0891b2"
    },
    "temp": {
        liveKey: "waterTemp",
        rangeKey: "waterTemp",
        label: "Water Temperature",
        unit: "°C",
        color: "#dc2626"
    },
    "salinity": {
        liveKey: "salinity",
        rangeKey: "salinity",
        label: "Salinity",
        unit: " ppt",
        color: "#7c3aed"
    },
    "turbidity": {
        liveKey: "turbidity",
        rangeKey: "turbidity",
        label: "Turbidity",
        unit: " NTU",
        color: "#b45309"
    },
    "tds": {
        liveKey: "tds",
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

// Fixed safe-zone fill bounds derived from the threshold range, not from the
// rolling window's data — so the band never shifts as live points scroll in
// and out, and appendLivePoint() can just push the same two constants on
// every tick instead of recomputing a pad from the current dataset.
function safeZoneBounds(range) {
    const hasMin = range.min != null;
    const hasMax = range.max != null;
    if (!hasMin && !hasMax) return null;

    const refWidth = hasMin && hasMax ? (range.max - range.min) : (hasMin ? range.min : range.max) * 0.5;
    const pad = Math.max(refWidth * 0.3, 0.5);

    return {
        min: hasMin ? range.min : Math.max(0, range.max - pad),
        max: hasMax ? range.max : range.min + pad
    };
}

const MAX_POINTS = 40; // ~10 min at ~15s/tick

let chartInstance     = null;
let currentSensorAttr = null;
let currentSafeBand   = null; // { min, max } | null — set on open, fixed for the session
let isModalReady      = false;
let isInitialSeeded   = false;
let lastTriggerEl     = null;

// Per-parameter rolling buffers keyed to SENSOR_CONFIG keys (ph, do, temp, salinity, turbidity, tds).
// Each buffer stores [{ time, value }] capped at MAX_POINTS.
// Persists in module memory across open/close for the lifetime of the page session.
const sensorBuffers = Object.keys(SENSOR_CONFIG).reduce((acc, key) => {
    acc[key] = [];
    return acc;
}, {});

function seedFromLatestOnce() {
    if (isInitialSeeded) return;
    const latest = window.latestSensorReading;
    if (!latest) return;
    isInitialSeeded = true;

    const time = latest.measuredAt?.toDate ? latest.measuredAt.toDate() : new Date();
    for (const [param, config] of Object.entries(SENSOR_CONFIG)) {
        const raw = latest[config.liveKey];
        if (raw != null && Number.isFinite(Number(raw))) {
            const buf = sensorBuffers[param];
            if (buf && buf.length === 0) {
                buf.push({ time, value: Number(raw) });
            }
        }
    }
}

function formatLabel(date) {
    return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function buildChart(canvas, config, points, band, safeText) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const labels = points.map(p => formatLabel(p.time));
    const values = points.map(p => p.value);

    const datasets = [];

    if (band) {
        datasets.push(
            {
                label: "__safeMin",
                data: labels.map(() => band.min),
                borderColor: "transparent",
                backgroundColor: "transparent",
                pointRadius: 0,
                fill: false,
                tension: 0,
                order: 10
            },
            {
                label: "Safe Zone",
                data: labels.map(() => band.max),
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

// Updates the open Chart.js instance using sensorBuffers[currentSensorAttr] as the
// single source of truth. Builds the chart once if not yet instantiated, or mutates
// labels and dataset values in place — guaranteed zero divergence from the buffer.
function updateLiveChart() {
    if (!currentSensorAttr || !isModalReady) return;
    const config = SENSOR_CONFIG[currentSensorAttr];
    if (!config) return;

    const canvas  = document.getElementById("shChart");
    const empty   = document.getElementById("shEmptyState");
    const safeEl  = document.getElementById("shSafeRangeText");
    const points  = sensorBuffers[currentSensorAttr] || [];

    if (points.length === 0) return;

    if (!chartInstance) {
        if (canvas) canvas.classList.remove("sh-hidden");
        if (empty)  empty.classList.add("sh-hidden");
        const safeText = safeEl ? safeEl.textContent : "";
        buildChart(canvas, config, points, currentSafeBand, safeText);
        return;
    }

    const labels = points.map(p => formatLabel(p.time));
    const values = points.map(p => p.value);

    chartInstance.data.labels = labels;
    if (currentSafeBand && chartInstance.data.datasets.length === 3) {
        chartInstance.data.datasets[0].data = labels.map(() => currentSafeBand.min);
        chartInstance.data.datasets[1].data = labels.map(() => currentSafeBand.max);
        chartInstance.data.datasets[2].data = values;
    } else {
        const valDs = chartInstance.data.datasets[chartInstance.data.datasets.length - 1];
        if (valDs) valDs.data = values;
    }
    chartInstance.update();
}

async function openModal(sensorAttr) {
    const config = SENSOR_CONFIG[sensorAttr];
    if (!config) return;

    currentSensorAttr = sensorAttr;
    isModalReady      = false;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const overlay  = document.getElementById("sensorHistoryModal");
    const title    = document.getElementById("shModalTitle");
    const subtitle = document.getElementById("shModalSubtitle");
    const canvas   = document.getElementById("shChart");
    const empty    = document.getElementById("shEmptyState");
    const safeEl   = document.getElementById("shSafeRangeText");

    if (title)    title.textContent    = config.label + " — Live";
    if (subtitle) subtitle.textContent = `Last ~${Math.round(MAX_POINTS * 15 / 60)} minutes`;

    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    const closeBtn = document.getElementById("shModalClose");
    if (closeBtn) closeBtn.focus();

    await loadThresholds();
    if (currentSensorAttr !== sensorAttr) return;
    if (!overlay.classList.contains("active")) return;

    const range = getRanges()[config.rangeKey];
    currentSafeBand = safeZoneBounds(range);
    if (safeEl) safeEl.textContent = buildSafeText(range, config.unit);
    isModalReady = true;

    // Guarded fallback seed: if no live ticks have fired yet and window.latestSensorReading exists
    seedFromLatestOnce();

    const points = sensorBuffers[sensorAttr] || [];
    if (points.length > 0) {
        if (canvas) canvas.classList.remove("sh-hidden");
        if (empty)  empty.classList.add("sh-hidden");
        const safeText = safeEl ? safeEl.textContent : "";
        buildChart(canvas, config, points, currentSafeBand, safeText);
    } else if (canvas && empty) {
        canvas.classList.add("sh-hidden");
        empty.textContent = "Waiting for live data…";
        empty.classList.remove("sh-hidden");
    }
}

function closeModal() {
    const overlay = document.getElementById("sensorHistoryModal");
    if (!overlay) return;
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    currentSensorAttr = null;
    currentSafeBand   = null;
    isModalReady      = false;
    if (lastTriggerEl) { lastTriggerEl.focus(); lastTriggerEl = null; }
    // Note: sensorBuffers is intentionally preserved across modal open/close sessions
}

export function initSensorHistoryModal() {
    // Initial guarded seed if latest reading is already globally available
    seedFromLatestOnce();

    document.querySelectorAll(".sensor-card[data-sensor]").forEach(card => {
        if (!SENSOR_CONFIG[card.dataset.sensor]) return;

        const hint = document.createElement("div");
        hint.className = "sh-card-hint";
        hint.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
        hint.setAttribute("aria-hidden", "true");
        card.appendChild(hint);
        card.addEventListener("click", () => { lastTriggerEl = card; openModal(card.dataset.sensor); });
        card.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                lastTriggerEl = card;
                openModal(card.dataset.sensor);
            }
        });
    });

    const overlay = document.getElementById("sensorHistoryModal");
    if (overlay) {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) closeModal();
        });
    }

    const closeBtn = document.getElementById("shModalClose");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    // Persistent listener attached once. Accumulates rolling readings in the
    // background for ALL parameters, and updates the live chart if open.
    document.addEventListener("sensor-reading-updated", (e) => {
        if (!e.detail) return;
        isInitialSeeded = true; // Live events are active; never seed stale latest
        const time = e.detail.measuredAt?.toDate ? e.detail.measuredAt.toDate() : new Date();

        // 1. Background accumulation for ALL parameters
        for (const [param, config] of Object.entries(SENSOR_CONFIG)) {
            const raw = e.detail[config.liveKey];
            if (raw == null || !Number.isFinite(Number(raw))) continue;

            const buf = sensorBuffers[param];
            if (!buf) continue;

            const val = Number(raw);
            const last = buf[buf.length - 1];
            // Deduplicate if identical timestamp already exists at head
            if (last && last.time.getTime() === time.getTime()) {
                last.value = val;
            } else {
                buf.push({ time, value: val });
                if (buf.length > MAX_POINTS) buf.shift();
            }
        }

        // 2. If modal is open, re-render chart from buffer (single source of truth)
        const modalOverlay = document.getElementById("sensorHistoryModal");
        if (!modalOverlay || !modalOverlay.classList.contains("active")) return;
        updateLiveChart();
    });

    document.addEventListener("keydown", e => {
        const o = document.getElementById("sensorHistoryModal");
        if (!o || !o.classList.contains("active")) return;

        if (e.key === "Escape") {
            closeModal();
            return;
        }

        if (e.key === "Tab") {
            const focusable = Array.from(o.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
                .filter(el => !el.disabled && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last  = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });
}
