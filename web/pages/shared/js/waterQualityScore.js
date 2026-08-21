import { getRanges } from "./thresholds.js";

/*
 * waterQualityScore.js — single source of truth for the Water Quality Score
 * used on analytics.html (recommendation cards' efficiency donut, and the
 * yield/income projections). Previously duplicated, with drift, across
 * analyticsRecommendations.js and yieldPrediction.js.
 *
 * Binary threshold score: a param is 1.0 if its current value falls within
 * getRanges()[key]'s [min, max] (one-sided/unbounded sides respected), else
 * 0.0. No partial credit, no invented "excellent"/"poor" tiers, no floor —
 * the final score is the plain fraction of measured params in range.
 */

export const SENSOR_KEYS = [
    "phLevel", "waterTemp", "dissolvedOxygen",
    "salinity", "turbidity", "waterLevel"
];

/**
 * scoreParam(key, value)
 *
 * Per-parameter score: 1.0 if value is within getRanges()[key]'s [min, max]
 * (a null bound is treated as unbounded on that side), 0.0 if out of range.
 * Returns null when the param can't be judged — value missing/non-numeric,
 * or no threshold configured for key — so callers can exclude it from an
 * average instead of it silently counting as a pass or fail. waterLevel is
 * boolean (safe/unsafe), not a min/max band — see aquaponicsReading.js.
 * Bounds are read live from getRanges() so this stays in sync with whatever
 * an admin configures in Settings.
 */
export function scoreParam(key, value) {
    if (key === "waterLevel" && typeof value === "boolean") {
        return value ? 1.0 : 0.0;
    }
    if (value == null || !Number.isFinite(Number(value))) return null;

    const v = Number(value);
    const range = getRanges()[key];
    if (!range) return null;

    const { min, max } = range;
    const hasMin = min != null;
    const hasMax = max != null;
    const inRange = (!hasMin || v >= min) && (!hasMax || v <= max);
    return inRange ? 1.0 : 0.0;
}

/**
 * calcWaterQualityScore(sensorData)
 *
 * Plain fraction of SENSOR_KEYS params currently within their safe range —
 * no compression, no floor. 6/6 in range = 1.0 (100%), 0/6 = 0.0 (0%).
 * Params scoreParam() can't judge (missing/non-numeric, no threshold) are
 * excluded from the average rather than counted as a pass or fail. Returns
 * null if sensorData itself is missing, or every param is unjudgeable.
 */
export function calcWaterQualityScore(sensorData) {
    if (!sensorData) return null;
    const scores = SENSOR_KEYS
        .map((k) => scoreParam(k, sensorData[k]))
        .filter((s) => s != null);
    if (!scores.length) return null;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
