import { db } from "./firebase.js";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SENSOR_CONFIG = {
    "ph": {
        key: "phLevel",
        label: "pH Level",
        unit: "",
        safeMin: 6.5,
        safeMax: 8.5,
        safeText: "Safe range: 6.5 – 8.5",
        color: "#2563eb"
    },
    "do": {
        key: "dissolvedOxygen",
        label: "Dissolved Oxygen",
        unit: " mg/L",
        safeMin: 5,
        safeMax: null,
        safeText: "Safe range: above 5 mg/L",
        color: "#0891b2"
    },
    "temp": {
        key: "waterTemp",
        label: "Water Temperature",
        unit: "°C",
        safeMin: 22,
        safeMax: 32,
        safeText: "Safe range: 22 – 32°C",
        color: "#dc2626"
    },
    "salinity": {
        key: "salinity",
        label: "Salinity",
        unit: " ppt",
        safeMin: 0,
        safeMax: 5,
        safeText: "Safe range: 0 – 5 ppt",
        color: "#7c3aed"
    },
    "turbidity": {
        key: "turbidity",
        label: "Turbidity",
        unit: " NTU",
        safeMin: null,
        safeMax: 25,
        safeText: "Safe range: below 25 NTU",
        color: "#b45309"
    },
    "water-level": {
        key: "waterLevel",
        label: "Water Level",
        unit: " m",
        safeMin: 0.5,
        safeMax: 2.0,
        safeText: "Safe range: 0.5 – 2.0 m",
        color: "#0d9488"
    }
};

const RANGES = {
    "24h": { ms: 24 * 60 * 60 * 1000,       label: "Last 24 Hours" },
    "7d":  { ms: 7  * 24 * 60 * 60 * 1000,  label: "Last 7 Days"   },
    "30d": { ms: 30 * 24 * 60 * 60 * 1000,  label: "Last 30 Days"  }
};

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

async function fetchHistory(sensorKey, rangeKey) {
    const cutoff = new Date(Date.now() - RANGES[rangeKey].ms);
    const q = query(
        collection(db, "sensor_readings"),
        where("timestamp", ">=", Timestamp.fromDate(cutoff)),
        orderBy("timestamp", "desc"),
        limit(500)
    );
    const snap = await getDocs(q);
    return snap.docs
        .reverse()
        .map(doc => {
            const d   = doc.data();
            const val = d[sensorKey];
            if (val == null || !Number.isFinite(Number(val))) return null;
            return { time: d.timestamp.toDate(), value: Number(val) };
        })
        .filter(Boolean);
}

function buildChart(canvas, config, points, rangeKey) {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const labels = points.map(p => formatLabel(p.time, rangeKey));
    const values = points.map(p => p.value);

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const pad     = Math.max((dataMax - dataMin) * 0.3, 0.5);

    const safeMinFill = config.safeMin !== null ? config.safeMin : Math.max(0, dataMin - pad);
    const safeMaxFill = config.safeMax !== null ? config.safeMax : dataMax + pad;

    chartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets: [
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
                },
                {
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
                }
            ]
        },
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
                                return "  " + config.safeText;
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

    const canvas  = document.getElementById("shChart");
    const loading = document.getElementById("shLoadingState");
    const empty   = document.getElementById("shEmptyState");
    const safeEl  = document.getElementById("shSafeRangeText");

    if (canvas)  canvas.classList.add("sh-hidden");
    if (loading) loading.classList.remove("sh-hidden");
    if (empty)   empty.classList.add("sh-hidden");
    if (safeEl)  safeEl.textContent = config.safeText;

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    try {
        const points = await fetchHistory(config.key, rangeKey);
        if (loading) loading.classList.add("sh-hidden");

        if (!points.length) {
            if (empty) empty.classList.remove("sh-hidden");
            return;
        }

        if (canvas) canvas.classList.remove("sh-hidden");
        buildChart(canvas, config, points, rangeKey);
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
