import { db } from "./firebase.js";
import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
 * thresholds.js — single source of truth for water parameter safe ranges.
 *
 * Reads the same Firestore doc (settings/thresholds) that the Settings page
 * writes to (see settings.js), and maps its flat field names onto the same
 * { min, max, unit, label, safeRangeStr } shape used across the app (mirrors
 * the structure previously duplicated in alertsEngine.js's SAFE_RANGES).
 */

// Defaults are the R. Regalado (BFAR Pampanga, interview Dec 9 2025) ranges; see ruleBasis.js.
const DEFAULT_RANGES = {
    phLevel: {
        min: 7.0,  max: 8.5,
        unit: "",     label: "pH Level",          safeRangeStr: "7 – 8.5"
    },
    waterTemp: {
        min: 28,   max: 31,
        unit: "°C",   label: "Water Temperature", safeRangeStr: "28 – 31°C"
    },
    dissolvedOxygen: {
        min: 5,    max: null,
        unit: "mg/L", label: "Dissolved Oxygen",  safeRangeStr: "> 5 mg/L"
    },
    salinity: {
        min: null, max: 15,
        unit: "ppt",  label: "Salinity",          safeRangeStr: "0 – 15 ppt"
    },
    turbidity: {
        min: null, max: 100,
        unit: "NTU",  label: "Turbidity",         safeRangeStr: "< 100 NTU"
    },
    waterLevel: {
        min: 0.8,  max: 2.2,
        unit: "m",    label: "Water Level",       safeRangeStr: "0.8 – 2.2 m"
    },
    tds: {
        min: null, max: null,
        unit: "ppm",  label: "TDS",               safeRangeStr: ""
    }
};

// Firestore field -> [param, bound], shared by the range values and their source.
const FIELD_MAP = {
    ph_min:         ["phLevel", "min"],
    ph_max:         ["phLevel", "max"],
    temp_min:       ["waterTemp", "min"],
    temp_max:       ["waterTemp", "max"],
    o2_min:         ["dissolvedOxygen", "min"],
    salinity_min:   ["salinity", "min"],
    salinity_max:   ["salinity", "max"],
    turbidity_max:  ["turbidity", "max"],
    waterlevel_min: ["waterLevel", "min"],
    waterlevel_max: ["waterLevel", "max"],
    tds_min:        ["tds", "min"],
    tds_max:        ["tds", "max"]
};

let cachedRanges = null;
let cachedSources = {};
let loadPromise = null;

function fmt(v) {
    return v == null ? "—" : v;
}

function buildRangesFromFirestore(data) {
    const ranges = JSON.parse(JSON.stringify(DEFAULT_RANGES));
    const sources = {};

    for (const [field, [param, bound]] of Object.entries(FIELD_MAP)) {
        if (data[field] == null) continue;
        ranges[param][bound] = data[field];
        sources[param] = "saved";
    }

    ranges.phLevel.safeRangeStr        = `${fmt(ranges.phLevel.min)} – ${fmt(ranges.phLevel.max)}`;
    ranges.waterTemp.safeRangeStr      = `${fmt(ranges.waterTemp.min)} – ${fmt(ranges.waterTemp.max)}°C`;
    ranges.dissolvedOxygen.safeRangeStr = `> ${fmt(ranges.dissolvedOxygen.min)} mg/L`;
    ranges.salinity.safeRangeStr       = `${fmt(ranges.salinity.min)} – ${fmt(ranges.salinity.max)} ppt`;
    ranges.turbidity.safeRangeStr      = `< ${fmt(ranges.turbidity.max)} NTU`;
    ranges.waterLevel.safeRangeStr     = `${fmt(ranges.waterLevel.min)} – ${fmt(ranges.waterLevel.max)} m`;
    ranges.tds.safeRangeStr            = `${fmt(ranges.tds.min)} – ${fmt(ranges.tds.max)} ppm`;

    return { ranges, sources };
}

/**
 * loadThresholds()
 *
 * One-shot fetch of settings/thresholds from Firestore, mapped onto the
 * DEFAULT_RANGES shape (missing fields fall back to their default value).
 * Caches the result — concurrent/repeat calls across modules share one
 * in-flight fetch instead of re-querying Firestore.
 */
export async function loadThresholds() {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const snap = await getDoc(doc(db, "settings", "thresholds"));
            const built = snap.exists()
                ? buildRangesFromFirestore(snap.data())
                : { ranges: JSON.parse(JSON.stringify(DEFAULT_RANGES)), sources: {} };
            cachedRanges = built.ranges;
            cachedSources = built.sources;
        } catch (err) {
            console.warn("[thresholds] Could not load thresholds from Firestore; using defaults.", err);
            cachedRanges = JSON.parse(JSON.stringify(DEFAULT_RANGES));
            cachedSources = {};
        }
        return cachedRanges;
    })();

    return loadPromise;
}

/**
 * refreshThresholds()
 *
 * Bypasses the loadThresholds() memo and forces a fresh Firestore fetch.
 * Callers that must see thresholds written moments ago (e.g. re-evaluating
 * alerts right after a Settings save on the same page) should use this
 * instead of loadThresholds(), which would otherwise hand back a
 * pre-save cached result.
 */
export async function refreshThresholds() {
    loadPromise = null;
    return loadThresholds();
}

/**
 * getRanges()
 *
 * Synchronous access to the last loaded ranges. Returns DEFAULT_RANGES if
 * loadThresholds() hasn't resolved yet.
 */
export function getRanges() {
    return cachedRanges || DEFAULT_RANGES;
}

/** "saved" when any bound of param came from settings/thresholds, else "default". */
export function getRangeSource(param) {
    return cachedSources[param] || "default";
}

/**
 * computeSeverity(value, min, max)
 *
 * Evaluates how far outside the safe boundary a value is, expressed
 * as a ratio of the reference width (range width for two-sided bounds,
 * or the bound value itself for one-sided bounds like DO and turbidity).
 *   ratio <= 0.10: "low"
 *   0.10 < ratio <= 0.25: "medium"
 *   0.25 < ratio <= 0.50: "high"
 *   ratio > 0.50: "critical"
 */
export function computeSeverity(value, min, max) {
    const hasMin = min !== null && min !== undefined;
    const hasMax = max !== null && max !== undefined;
    const rangeRef = (hasMin && hasMax) ? (max - min) : (hasMin ? min : max);

    let ratio = 0;
    if (hasMin && value < min) {
        ratio = (min - value) / rangeRef;
    } else if (hasMax && value > max) {
        ratio = (value - max) / rangeRef;
    }

    if (ratio > 0.5)  return "critical";
    if (ratio > 0.25) return "high";
    if (ratio > 0.1)  return "medium";
    return "low";
}

export { DEFAULT_RANGES };

