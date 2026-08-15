import {
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds, getRanges } from "./thresholds.js";
import { AQUAPONICS_REF, normalizeAquaponicsReading, formatWaterLevelText } from "./aquaponicsReading.js";

/*
 * Firestore — Aquaponics/Ulang document (single doc, not a collection)
 *
 * Updated by the ESP32 in place roughly every 15 seconds. See
 * aquaponicsReading.js for the nested statistics.*.average → flat-object
 * mapping shared with yieldPrediction.js and analyticsRecommendations.js.
 *
 * waterLevel is a boolean (safe/unsafe), not a numeric depth — rendered via
 * formatWaterLevelText() and given its own status branch below instead of
 * going through the generic numeric SENSOR_MAP loop.
 */

const SENSOR_MAP = [
    { key: "phLevel",         selector: '[data-sensor="ph"]',           unit: "",      decimals: 1 },
    { key: "dissolvedOxygen", selector: '[data-sensor="do"]',           unit: " mg/L", decimals: 1 },
    { key: "waterTemp",       selector: '[data-sensor="temp"]',         unit: "°C",    decimals: 1 },
    { key: "tds",             selector: '[data-sensor="tds"]',          unit: " ppm",  decimals: 0 },
    { key: "salinity",        selector: '[data-sensor="salinity"]',     unit: " ppt",  decimals: 0 },
    { key: "turbidity",       selector: '[data-sensor="turbidity"]',    unit: " NTU",  decimals: 1 }
];

const STATUS_CSS   = { normal: "optimal",  warning: "warning",  critical: "critical" };
const STATUS_LABEL = { normal: "OPTIMAL",  warning: "WARNING",  critical: "CRITICAL" };

function getSensorStatus(key, value) {
    const range = getRanges()[key];
    if (!range || value == null || !Number.isFinite(Number(value))) return "normal";
    const v = Number(value);
    const { min, max } = range;
    const hasMin = min != null;
    const hasMax = max != null;

    const belowMin = hasMin && v < min;
    const aboveMax = hasMax && v > max;
    if (!belowMin && !aboveMax) return "normal";

    let ratio;
    if (hasMin && hasMax) {
        const rangeSize = max - min;
        ratio = belowMin ? (min - v) / rangeSize : (v - max) / rangeSize;
    } else if (hasMin) {
        // One-sided min (e.g. DO > 5): ratio relative to the minimum threshold
        ratio = (min - v) / min;
    } else {
        // One-sided max (e.g. turbidity < 25): ratio relative to the max threshold
        ratio = (v - max) / max;
    }

    return ratio <= 0.10 ? "warning" : "critical";
}

function formatValue(value, decimals, unit) {
    const n = Number(value);
    if (value == null || !Number.isFinite(n)) return "--";
    return (decimals === 0 ? Math.round(n) : n.toFixed(decimals)) + unit;
}

const VALUE_COLOR = { optimal: "#2563eb", warning: "#d97706", critical: "#dc2626" };

function applyCardStatus(card, status) {
    const statusEl = card.querySelector(".sensor-status");
    const iconWrap = card.querySelector(".sensor-icon-wrap");
    const valueEl  = card.querySelector(".sensor-value");
    const css      = STATUS_CSS[status]   || "optimal";
    const label    = STATUS_LABEL[status] || "OPTIMAL";

    ["optimal", "warning", "critical"].forEach(c => {
        if (statusEl) statusEl.classList.toggle(c, c === css);
        if (iconWrap) iconWrap.classList.toggle(c, c === css);
    });
    if (statusEl) statusEl.textContent = label;
    if (valueEl)  valueEl.style.color  = VALUE_COLOR[css];
}

function formatMeasuredAt(value) {
    if (!value) return "--";
    let date = null;
    if (typeof value.toDate === "function") date = value.toDate();
    else if (value instanceof Date) date = value;
    else if (typeof value.seconds === "number") date = new Date(value.seconds * 1000);
    else {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
    if (!date) return "--";
    return date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

function applyWaterLevelCard(sensorGrid, waterLevel, timeStr) {
    const card = sensorGrid.querySelector('[data-sensor="water-level"]');
    if (!card) return;

    const valueEl   = card.querySelector(".sensor-value");
    const updatedEl = card.querySelector(".sensor-updated");

    if (valueEl)   valueEl.textContent = formatWaterLevelText(waterLevel);
    if (updatedEl) updatedEl.textContent = "Updated: " + timeStr;

    const status = waterLevel == null ? "normal" : waterLevel ? "normal" : "critical";
    applyCardStatus(card, status);
}

function updateSensorCards(data) {
    const sensorGrid = document.getElementById("sensorGrid");
    if (!sensorGrid) return;

    const timeStr = formatMeasuredAt(data.measuredAt);

    SENSOR_MAP.forEach(({ key, selector, unit, decimals }) => {
        const card = sensorGrid.querySelector(selector);
        if (!card) return;

        const valueEl   = card.querySelector(".sensor-value");
        const updatedEl = card.querySelector(".sensor-updated");

        if (valueEl)   valueEl.textContent = formatValue(data[key], decimals, unit);
        if (updatedEl) updatedEl.textContent = "Updated: " + timeStr;

        applyCardStatus(card, getSensorStatus(key, data[key]));
    });

    applyWaterLevelCard(sensorGrid, data.waterLevel, timeStr);
}

/**
 * receiveSensorData()
 *
 * Opens a real-time Firestore listener on the Aquaponics/Ulang document.
 * Every time the ESP32 updates it (~every 15s), the listener fires, updates
 * every sensor card on the page, and broadcasts a "sensor-reading-updated"
 * CustomEvent so other modules (charts, alerts, etc.) can react.
 *
 * Sets window.sensorDataConnected = true on first successful read so the
 * simulation in real-time-monitoring.js knows to stop overwriting values.
 *
 * Awaits the (memoized) threshold load before attaching the listener, so the
 * very first rendered reading already reflects Firestore-configured
 * thresholds instead of briefly showing status against DEFAULT_RANGES.
 *
 * Returns a Promise resolving to the Firestore unsubscribe function — call
 * it to stop listening.
 */
export async function receiveSensorData() {
    // Memoized — safe to call even if another module (e.g. alertsEngine) already triggered it.
    await loadThresholds();

    const unsubscribe = onSnapshot(
        AQUAPONICS_REF,
        (snapshot) => {
            if (!snapshot.exists()) return;

            // Permanently kill both simulation intervals (tick + runClock)
            if (typeof window.stopSensorSimulation === "function") {
                window.stopSensorSimulation();
                window.stopSensorSimulation = null;
            }

            const data = normalizeAquaponicsReading(snapshot.data());

            updateSensorCards(data);

            // Make the latest reading globally accessible
            window.latestSensorReading = data;
            window.sensorDataConnected = true;

            // Broadcast so the dashboard, charts, or alerts can react
            document.dispatchEvent(
                new CustomEvent("sensor-reading-updated", { detail: data })
            );
        },
        (error) => {
            console.error("Aquaponics/Ulang listener error:", error);
        }
    );

    return unsubscribe;
}
