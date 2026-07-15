import { getRanges } from "./thresholds.js";

/*
 * waterQualityScore.js — single source of truth for the Water Quality Score
 * used on analytics.html (recommendation cards' efficiency donut, and the
 * yield/income projections). Previously duplicated, with drift, across
 * analyticsRecommendations.js and yieldPrediction.js.
 */

export const SENSOR_KEYS = [
    "phLevel", "waterTemp", "dissolvedOxygen",
    "salinity", "turbidity", "waterLevel"
];

// Fixed literature constants — NOT derived from getRanges(). These mark
// "excellent" targets that are independent of the configured safety
// min/max (e.g. 10 NTU is an excellent-clarity target regardless of what
// the turbidity max alert threshold is set to).
const DO_EXCELLENT        = 7;   // mg/L
const TURBIDITY_EXCELLENT = 10;  // NTU

/**
 * scoreParam(key, value)
 *
 * Per-parameter quality score in [0.0, 1.0]. Bounds are read live from the
 * shared thresholds module (getRanges()) so this stays in sync with
 * whatever an admin configures in Settings.
 */
export function scoreParam(key, value) {
    if (value == null || !Number.isFinite(Number(value))) return 0.5;
    const v = Number(value);
    const range = getRanges()[key];
    if (!range) return 0.5;
    const { min, max } = range;
    switch (key) {
        case "phLevel": {
            const lo = min - 0.5, hi = max + 0.5;
            return (v >= min && v <= max) ? 1.0 : ((v >= lo && v < min) || (v > max && v <= hi)) ? 0.6 : 0.3;
        }
        case "waterTemp": {
            const lo = min - 4, hi = max + 4; // this band's own +4 edge — distinct from the alert engine's +3 critical cutoff
            return (v >= min && v <= max) ? 1.0 : ((v >= lo && v < min) || (v > max && v <= hi)) ? 0.6 : 0.3;
        }
        case "dissolvedOxygen": {
            const poor = min - 2;
            return v >= DO_EXCELLENT ? 1.0 : v >= min ? 0.8 : v >= poor ? 0.5 : 0.2;
        }
        case "salinity": {
            const tier2 = max + 5, tier3 = max + 10;
            return (v <= max) ? 1.0 : (v <= tier2) ? 0.7 : (v <= tier3) ? 0.5 : 0.3;
        }
        case "turbidity": {
            const poor = max + 25;
            return v <= TURBIDITY_EXCELLENT ? 1.0 : v <= max ? 0.8 : v <= poor ? 0.5 : 0.2;
        }
        case "waterLevel": {
            const lo = min - 0.2, hi = max + 0.5;
            return (v >= min && v <= max) ? 1.0 : ((v >= lo && v < min) || (v > max && v <= hi)) ? 0.7 : 0.4;
        }
        default:
            return 0.5;
    }
}

/**
 * calcWaterQualityScore(sensorData)
 *
 * Averages every SENSOR_KEYS score and maps [0, 1] → [0.5, 1.0]. Returns
 * 0.75 (the midpoint of that mapped range) when sensorData is missing.
 */
export function calcWaterQualityScore(sensorData) {
    if (!sensorData) return 0.75;
    const avg = SENSOR_KEYS.reduce((sum, k) => sum + scoreParam(k, sensorData[k]), 0) / SENSOR_KEYS.length;
    return 0.5 + avg * 0.5;
}
