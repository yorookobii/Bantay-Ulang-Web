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

const DEFAULT_RANGES = {
    phLevel: {
        min: 6.5,  max: 8.5,
        unit: "",     label: "pH Level",          safeRangeStr: "6.5 – 8.5"
    },
    waterTemp: {
        min: 22,   max: 32,
        unit: "°C",   label: "Water Temperature", safeRangeStr: "22 – 32°C"
    },
    dissolvedOxygen: {
        min: 5,    max: null,
        unit: "mg/L", label: "Dissolved Oxygen",  safeRangeStr: "> 5 mg/L"
    },
    salinity: {
        min: null, max: 5,
        unit: "ppt",  label: "Salinity",          safeRangeStr: "0 – 5 ppt"
    },
    turbidity: {
        min: null, max: 25,
        unit: "NTU",  label: "Turbidity",         safeRangeStr: "< 25 NTU"
    },
    waterLevel: {
        min: 0.5,  max: 2.0,
        unit: "m",    label: "Water Level",       safeRangeStr: "0.5 – 2.0 m"
    },
    tds: {
        min: null, max: null,
        unit: "ppm",  label: "TDS",               safeRangeStr: ""
    }
};

let cachedRanges = null;
let loadPromise = null;

function fmt(v) {
    return v == null ? "—" : v;
}

function buildRangesFromFirestore(data) {
    const ranges = JSON.parse(JSON.stringify(DEFAULT_RANGES));

    if (data.ph_min        != null) ranges.phLevel.min         = data.ph_min;
    if (data.ph_max         != null) ranges.phLevel.max         = data.ph_max;
    if (data.temp_min       != null) ranges.waterTemp.min       = data.temp_min;
    if (data.temp_max       != null) ranges.waterTemp.max       = data.temp_max;
    if (data.o2_min         != null) ranges.dissolvedOxygen.min = data.o2_min;
    if (data.salinity_min   != null) ranges.salinity.min        = data.salinity_min;
    if (data.salinity_max   != null) ranges.salinity.max        = data.salinity_max;
    if (data.turbidity_max  != null) ranges.turbidity.max       = data.turbidity_max;
    if (data.waterlevel_min != null) ranges.waterLevel.min      = data.waterlevel_min;
    if (data.waterlevel_max != null) ranges.waterLevel.max      = data.waterlevel_max;
    if (data.tds_min        != null) ranges.tds.min             = data.tds_min;
    if (data.tds_max        != null) ranges.tds.max             = data.tds_max;

    ranges.phLevel.safeRangeStr        = `${fmt(ranges.phLevel.min)} – ${fmt(ranges.phLevel.max)}`;
    ranges.waterTemp.safeRangeStr      = `${fmt(ranges.waterTemp.min)} – ${fmt(ranges.waterTemp.max)}°C`;
    ranges.dissolvedOxygen.safeRangeStr = `> ${fmt(ranges.dissolvedOxygen.min)} mg/L`;
    ranges.salinity.safeRangeStr       = `${fmt(ranges.salinity.min)} – ${fmt(ranges.salinity.max)} ppt`;
    ranges.turbidity.safeRangeStr      = `< ${fmt(ranges.turbidity.max)} NTU`;
    ranges.waterLevel.safeRangeStr     = `${fmt(ranges.waterLevel.min)} – ${fmt(ranges.waterLevel.max)} m`;
    ranges.tds.safeRangeStr            = `${fmt(ranges.tds.min)} – ${fmt(ranges.tds.max)} ppm`;

    return ranges;
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
            cachedRanges = snap.exists()
                ? buildRangesFromFirestore(snap.data())
                : JSON.parse(JSON.stringify(DEFAULT_RANGES));
        } catch (err) {
            console.warn("[thresholds] Could not load thresholds from Firestore; using defaults.", err);
            cachedRanges = JSON.parse(JSON.stringify(DEFAULT_RANGES));
        }
        return cachedRanges;
    })();

    return loadPromise;
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

export { DEFAULT_RANGES };
