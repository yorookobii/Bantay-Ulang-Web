import {
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds, getRanges, computeSeverity } from "./thresholds.js";
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
    { key: "salinity",        selector: '[data-sensor="salinity"]',     unit: " ppt",  decimals: 2 },
    { key: "turbidity",       selector: '[data-sensor="turbidity"]',    unit: " NTU",  decimals: 1 }
];

const STATUS_CSS   = { normal: "optimal",  warning: "warning",  critical: "critical",  "no-data": "no-data" };
const STATUS_LABEL = { normal: "OPTIMAL",  warning: "WARNING",  critical: "CRITICAL",  "no-data": "NO DATA" };

// Tier 1 (this fix): a null/non-finite value is "no data received," not
// "in range" — must not render as the same green OPTIMAL as a real in-range
// reading (mirrors the Analytics rec-card-no-data fix). Tier 2 (not done
// here): this still can't tell a genuinely-null value apart from a
// stale-but-numeric last value frozen in the Aquaponics/Ulang doc after the
// ESP32 goes offline — that needs the same freshness/measuredAt mechanism
// dashboard.js uses for the hardware-status tile.
function getSensorStatus(key, value) {
    const range = getRanges()[key];
    // !range is left mapped to "normal": every SENSOR_MAP key has a
    // DEFAULT_RANGES entry (thresholds.js), so getRanges()[key] is never
    // actually missing in practice — this is an unreachable defensive guard,
    // not a real no-data path, so conflating it with "no-data" isn't needed.
    if (!range) return "normal";
    if (value == null || !Number.isFinite(Number(value))) return "no-data";
    const v = Number(value);
    const { min, max } = range;
    const hasMin = min != null;
    const hasMax = max != null;
    if (!hasMin && !hasMax) return "normal"; // unconfigured threshold — no band possible

    const belowMin = hasMin && v < min;
    const aboveMax = hasMax && v > max;

    // 1. Out of range — map severity to card status:
    //    low / medium -> "warning" (amber)
    //    high / critical -> "critical" (red)
    if (belowMin || aboveMax) {
        const severity = computeSeverity(v, min, max);
        return (severity === "critical" || severity === "high") ? "critical" : "warning";
    }

    // 2. In range — flag the near-edge 10% band as a warning.
    //    The near-MIN 10% warning is skipped when min <= 0 (being near zero when zero is the floor is safe).
    if (hasMin && hasMax) {
        const edgeBand = (max - min) * 0.10;
        // near-MAX always applies:
        if (v >= max - edgeBand) return "warning";
        // near-MIN only if the floor is meaningfully above zero:
        if (min > 0 && v <= min + edgeBand) return "warning";
    } else if (hasMin) {
        if (min > 0 && v <= min * 1.10) return "warning";
    } else {
        if (v >= max * 0.90) return "warning";
    }

    // 3. In range comfortable -> "normal" (optimal green)
    return "normal";
}

function formatValue(value, decimals, unit) {
    const n = Number(value);
    if (value == null || !Number.isFinite(n)) return "--";
    return (decimals === 0 ? Math.round(n) : n.toFixed(decimals)) + unit;
}

const VALUE_COLOR = { optimal: "#2563eb", warning: "#d97706", critical: "#dc2626", "no-data": "#4b5563" };

function applyCardStatus(card, status) {
    const statusEl = card.querySelector(".sensor-status");
    const iconWrap = card.querySelector(".sensor-icon-wrap");
    const valueEl  = card.querySelector(".sensor-value");
    const css      = STATUS_CSS[status]   || "optimal";
    const label    = STATUS_LABEL[status] || "OPTIMAL";

    ["optimal", "warning", "critical", "no-data"].forEach(c => {
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

    const status = waterLevel == null ? "no-data" : waterLevel ? "normal" : "critical";
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
