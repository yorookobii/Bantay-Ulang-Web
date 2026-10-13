import { getRanges } from "./thresholds.js";
import { isSuspect } from "./plausibility.js";

// ─── Status computation (moved from history.js so the report shares it) ─────
// HistoryLogs readings carry no stored status field (unlike the old sensor_readings
// docs) — status is computed client-side against thresholds.js. Binary only:
// within range = normal, any breach = out-of-range. No warning/critical split —
// there's no literature-backed ratio threshold to invent one. Callers must
// await loadThresholds() first, or getRanges() falls back to DEFAULT_RANGES.
//
// Reading field name -> thresholds.js key. Most match directly; "ph" is the one
// mismatch (thresholds.js still uses the legacy "phLevel" key). waterLevel is
// intentionally excluded: it's boolean, not a min/max-checkable numeric param
// (same reasoning as dropping its column/chart in Parts 5-6).
export const THRESHOLD_KEY = {
    ph:              "phLevel",
    waterTemp:       "waterTemp",
    dissolvedOxygen: "dissolvedOxygen",
    salinity:        "salinity",
    turbidity:       "turbidity",
    tds:             "tds"
};
export const STATUS_PARAMS = Object.keys(THRESHOLD_KEY);

// "low" | "high" | null for one value against its configured range; suspect or missing values never breach.
export function breachDirection(param, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    // A physically impossible value is a sensor fault, not a water condition.
    if (isSuspect(param, value)) return null;
    const range = getRanges()[THRESHOLD_KEY[param]];
    if (!range) return null;
    const hasMin = range.min !== null && range.min !== undefined;
    const hasMax = range.max !== null && range.max !== undefined;
    if (hasMin && value < range.min) return "low";
    if (hasMax && value > range.max) return "high";
    return null;
}

export function isBreached(param, value) {
    return breachDirection(param, value) !== null;
}

// Breached params of one reading, e.g. [{ param: "ph", dir: "low" }].
export function readingBreaches(reading) {
    return STATUS_PARAMS
        .map(param => ({ param, dir: breachDirection(param, reading[param]) }))
        .filter(b => b.dir);
}

// Precedence: out-of-range > suspect (physically impossible value, see
// plausibility.js) > no-data (all params missing) > incomplete (some
// missing) > normal. Missing values must never read as "Normal" — docs without
// a statistics map (firmware wrote no sensor data) normalize to all-null.
// Params with no configured threshold (e.g. tds if unset in Settings) simply
// can't breach — isBreached() returns false for them via the !range guard.
export function computeRowStatus(reading) {
    if (STATUS_PARAMS.some(param => isBreached(param, reading[param]))) return "out-of-range";
    if (STATUS_PARAMS.some(param => isSuspect(param, reading[param]))) return "suspect";
    const missing = STATUS_PARAMS.filter(param => !Number.isFinite(reading[param])).length;
    if (missing === STATUS_PARAMS.length) return "no-data";
    if (missing > 0) return "incomplete";
    return "normal";
}
