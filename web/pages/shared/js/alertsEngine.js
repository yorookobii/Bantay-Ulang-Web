import { db } from "./firebase.js";
import {
    collection,
    doc,
    query,
    where,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
 * Firestore — alerts collection
 *
 * Documents are created and resolved automatically by this module whenever a
 * sensor_reading crosses outside the defined safe ranges.
 *
 * Schema:
 *   type         : string    – "out_of_range" | "critical_out_of_range"
 *   parameter    : string    – sensor field name, e.g. "phLevel"
 *   currentValue : number    – value that triggered or last updated this alert
 *   safeRange    : string    – human-readable safe range, e.g. "6.5 – 8.5"
 *   message      : string    – plain-English description + suggested corrective action
 *   severity     : string    – "low" | "medium" | "high" | "critical"
 *   status       : string    – "active" | "resolved"
 *   createdAt    : timestamp – server timestamp when alert was first created
 *   resolvedAt   : timestamp – server timestamp when alert was resolved (resolved docs only)
 *   deviceId     : string    – originating device identifier, e.g. "ESP32-001"
 */

const SAFE_RANGES = {
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
    }
};

const SUGGESTIONS = {
    phLevel: {
        high: "Add acid buffer or increase water change frequency.",
        low:  "Add alkaline buffer or check CO₂ and aeration levels."
    },
    waterTemp: {
        high: "Check cooling systems and reduce direct sunlight exposure.",
        low:  "Check heater operation and verify tank insulation."
    },
    dissolvedOxygen: {
        low: "Increase aeration immediately. Inspect air pump and diffusers."
    },
    salinity: {
        high: "Dilute gradually with fresh water.",
        low:  "Add aquarium salt gradually to reach target salinity."
    },
    turbidity: {
        high: "Inspect and clean the filtration system. Consider a partial water change."
    },
    waterLevel: {
        high: "Check inlet valve and overflow drainage immediately.",
        low:  "Inspect for leaks and restore water supply."
    }
};

// Severity is based on how far outside the safe boundary the value is,
// expressed as a ratio of the reference width (range width for two-sided bounds,
// or the bound value itself for one-sided bounds like DO and turbidity).
function computeSeverity(value, min, max) {
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

function buildMessage(param, value, isHigh) {
    const { label, unit, safeRangeStr } = SAFE_RANGES[param];
    const direction = isHigh ? "above" : "below";
    const suggestion = (SUGGESTIONS[param] || {})[isHigh ? "high" : "low"] || "";
    const display = Number.isFinite(value)
        ? (Number.isInteger(value) ? value : parseFloat(value.toFixed(2)))
        : value;
    const valueStr = unit ? `${display} ${unit}` : String(display);
    return `${label} is ${direction} the safe range. Current: ${valueStr}. Safe range: ${safeRangeStr}. ${suggestion}`.trim();
}

// ── Auto-task generation playbook ────────────────────────────────────────────

const TASK_PLAYBOOK = {
    phLevel: {
        low: {
            title:    "Magdagdag ng Buffer sa Tubig",
            desc:     "Bumaba ang pH ng tubig. Maglagay ng kaunting potassium bicarbonate o dinurog na shell/eggshell sa tubig. Huwag biglain — unti-unti lang.",
            assignTo: "farmer"
        },
        high: {
            title:    "Bawasan Muna ang Pagpapakain",
            desc:     "Mataas ang pH ngayon. Bawasan muna ang dami ng pagkain na ibibigay sa ulang. I-check din kung malinis ang panggaling ng tubig.",
            assignTo: "farmer"
        }
    },
    dissolvedOxygen: {
        low: {
            title:    "Bawasan ang Pagpapakain, Linisin ang Tubig",
            desc:     "Mababa ang oxygen sa tubig. Bawasan ang pagkain at tanggalin ang mga nakikitang dumi o tira-tira sa tubig.",
            assignTo: "farmer"
        }
    },
    turbidity: {
        high: {
            title:    "Bawasan ang Pagpapakain, Alisin ang Dumi",
            desc:     "Malabo ang tubig ngayon. Bawasan muna ang pagkain at alisin ang nakikitang dumi sa tubig.",
            assignTo: "farmer"
        }
    },
    waterTemp: {
        high: {
            title:    "I-check ang Lilim/Shade",
            desc:     "Mataas ang temperatura ng tubig. I-check kung sapat ang lilim para hindi sobrang init ang araw na tumatama sa tangke.",
            assignTo: "farmer"
        }
    },
    salinity: {
        low: {
            title:    "I-check ang Pinagmumulan ng Tubig",
            desc:     "Hindi normal ang lasa/asin ng tubig. I-check kung may halong maalat na tubig o ulan.",
            assignTo: "farmer"
        },
        high: {
            title:    "I-check ang Pinagmumulan ng Tubig",
            desc:     "Hindi normal ang lasa/asin ng tubig. I-check kung may halong maalat na tubig o ulan.",
            assignTo: "farmer"
        }
    },
    waterLevel: {
        low: {
            title:    "I-check ang Pump/Tubo, Baka May Tagas",
            desc:     "Bumababa ang lebel ng tubig. I-check ang pump at mga tubo kung may tagas o barado.",
            assignTo: "technician"
        },
        high: {
            title:    "I-check ang Drainage/Overflow",
            desc:     "Sumosobra ang tubig. I-check ang drainage kung barado o sira.",
            assignTo: "technician"
        }
    }
};

// Returns the Firestore UID of the first matching user.
// Queries by role only (single-field index) and filters status in memory.
async function findFirstUserByRole(role, requireActive = false) {
    try {
        const snap = await getDocs(
            query(collection(db, "users"), where("role", "==", role))
        );
        if (snap.empty) return null;
        if (!requireActive) return snap.docs[0].id;
        const match = snap.docs.find(d => d.data().status === "active");
        return match ? match.id : null;
    } catch {
        return null;
    }
}

// Queries tasks by parameter only (avoids composite index) then filters status in memory.
async function hasPendingTask(param) {
    try {
        const q = query(collection(db, "tasks"), where("parameterTriggered", "==", param));
        console.log(`[alertsEngine] hasPendingTask: querying tasks where parameterTriggered == "${param}"`);
        const snap = await getDocs(q);
        console.log(`[alertsEngine] hasPendingTask: found ${snap.size} task doc(s) for "${param}"`);
        return snap.docs.some(d => {
            const s = d.data().status;
            return s !== "done" && s !== "completed";
        });
    } catch (err) {
        console.error(`[alertsEngine] hasPendingTask: Firestore query failed for "${param}" — check security rules on tasks collection.`, err);
        return false; // fail open so the task creation still proceeds
    }
}

async function autoCreateTask(param, severity, isHigh) {
    console.log(`[alertsEngine] autoCreateTask() entered — param=${param}, severity=${severity}, isHigh=${isHigh}`);

    const direction = isHigh ? "high" : "low";
    const playbook  = (TASK_PLAYBOOK[param] || {})[direction];
    if (!playbook) {
        console.warn(`[alertsEngine] autoCreateTask: no playbook entry for ${param}/${direction} — skipping.`);
        return;
    }

    const pending = await hasPendingTask(param);
    if (pending) {
        console.log(`[alertsEngine] autoCreateTask: skipping ${param} — unresolved task already exists.`);
        return;
    }

    let assignedTo;
    if (playbook.assignTo === "technician") {
        assignedTo = await findFirstUserByRole("technician");
    } else {
        assignedTo = await findFirstUserByRole("user", true);
        if (!assignedTo) {
            console.warn(`[alertsEngine] autoCreateTask: no active farmer (role=user, status=active) found — assignedTo will be null.`);
            assignedTo = null;
        }
    }

    console.log(`[alertsEngine] autoCreateTask: writing task to Firestore — title="${playbook.title}", assignedTo=${assignedTo}`);
    try {
        await addDoc(collection(db, "tasks"), {
            title:              playbook.title,
            description:        playbook.desc,
            status:             "pending",
            createdAt:          serverTimestamp(),
            createdBy:          "system",
            parameterTriggered: param,
            severityTriggered:  severity,
            assignedTo,
            assignedRole:       playbook.assignTo
        });
        console.log(`[alertsEngine] Auto-task created for ${param} (${direction}, ${severity}).`);
    } catch (err) {
        console.error(`[alertsEngine] autoCreateTask: addDoc failed — check security rules on tasks collection.`, err);
    }
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

// Queries by parameter only (single-field index, no composite index needed) then
// filters status and deviceId in memory to avoid requiring a composite Firestore index.
async function findActiveAlert(param, deviceId) {
    const snap = await getDocs(
        query(collection(db, "alerts"), where("parameter", "==", param))
    );
    const match = snap.docs.find(d => {
        const data = d.data();
        return data.status === "active" && data.deviceId === deviceId;
    });
    return match || null;
}

async function handleParameter(param, value, deviceId) {
    const { min, max, safeRangeStr } = SAFE_RANGES[param];
    const hasMin = min !== null && min !== undefined;
    const hasMax = max !== null && max !== undefined;

    const belowMin   = hasMin && value < min;
    const aboveMax   = hasMax && value > max;
    const outOfRange = belowMin || aboveMax;

    const existing = await findActiveAlert(param, deviceId);

    if (outOfRange) {
        const severity  = computeSeverity(value, min, max);
        const message   = buildMessage(param, value, aboveMax);
        const alertType = severity === "critical" ? "critical_out_of_range" : "out_of_range";

        if (existing) {
            // Update the live alert with the latest value and recalculated severity.
            await updateDoc(existing.ref, { currentValue: value, message, severity });
            // Task may not exist yet if alert pre-dates the task engine — create it if missing.
            await autoCreateTask(param, severity, aboveMax);
        } else {
            await addDoc(collection(db, "alerts"), {
                type:         alertType,
                parameter:    param,
                currentValue: value,
                safeRange:    safeRangeStr,
                message,
                severity,
                status:    "active",
                createdAt: serverTimestamp(),
                deviceId
            });
            // Auto-create a matching task for this new alert.
            await autoCreateTask(param, severity, aboveMax);
        }
    } else if (existing) {
        // Parameter returned to safe range — resolve the alert.
        await updateDoc(existing.ref, {
            status:       "resolved",
            resolvedAt:   serverTimestamp(),
            currentValue: value
        });
    }
}

/**
 * processSensorReading(data)
 *
 * Accepts a sensor_readings document payload and evaluates every monitored
 * parameter against its safe range, creating or resolving alerts in Firestore.
 * Can be called directly (e.g. from tests or one-off checks).
 */
export async function processSensorReading(data) {
    const deviceId = data.deviceId || "unknown";
    await Promise.all(
        Object.keys(SAFE_RANGES)
            .filter(param => data[param] != null && Number.isFinite(Number(data[param])))
            .map(param => handleParameter(param, Number(data[param]), deviceId))
    );
}

// ── Firestore threshold loading ───────────────────────────────────────────────

async function loadThresholdsFromFirestore() {
    try {
        const snap = await getDoc(doc(db, "settings", "thresholds"));
        if (!snap.exists()) return;
        const t = snap.data();

        if (t.ph_min        != null) SAFE_RANGES.phLevel.min          = t.ph_min;
        if (t.ph_max        != null) SAFE_RANGES.phLevel.max          = t.ph_max;
        if (t.temp_min      != null) SAFE_RANGES.waterTemp.min        = t.temp_min;
        if (t.temp_max      != null) SAFE_RANGES.waterTemp.max        = t.temp_max;
        if (t.o2_min        != null) SAFE_RANGES.dissolvedOxygen.min  = t.o2_min;
        if (t.salinity_min  != null) SAFE_RANGES.salinity.min         = t.salinity_min;
        if (t.salinity_max  != null) SAFE_RANGES.salinity.max         = t.salinity_max;
        if (t.turbidity_max != null) SAFE_RANGES.turbidity.max        = t.turbidity_max;
        if (t.waterlevel_min != null) SAFE_RANGES.waterLevel.min      = t.waterlevel_min;
        if (t.waterlevel_max != null) SAFE_RANGES.waterLevel.max      = t.waterlevel_max;

        // Rebuild safeRangeStr labels so alert messages stay accurate.
        const fmt = (v) => (v == null ? "—" : v);
        SAFE_RANGES.phLevel.safeRangeStr          = `${fmt(SAFE_RANGES.phLevel.min)} – ${fmt(SAFE_RANGES.phLevel.max)}`;
        SAFE_RANGES.waterTemp.safeRangeStr         = `${fmt(SAFE_RANGES.waterTemp.min)} – ${fmt(SAFE_RANGES.waterTemp.max)}°C`;
        SAFE_RANGES.dissolvedOxygen.safeRangeStr   = `> ${fmt(SAFE_RANGES.dissolvedOxygen.min)} mg/L`;
        SAFE_RANGES.salinity.safeRangeStr          = `${fmt(SAFE_RANGES.salinity.min)} – ${fmt(SAFE_RANGES.salinity.max)} ppt`;
        SAFE_RANGES.turbidity.safeRangeStr         = `< ${fmt(SAFE_RANGES.turbidity.max)} NTU`;
        SAFE_RANGES.waterLevel.safeRangeStr        = `${fmt(SAFE_RANGES.waterLevel.min)} – ${fmt(SAFE_RANGES.waterLevel.max)} m`;

        console.log("[alertsEngine] Thresholds loaded from Firestore.");
    } catch (err) {
        console.warn("[alertsEngine] Could not load thresholds from Firestore; using defaults.", err);
    }
}

/**
 * startAlertsEngine()
 *
 * Attaches a listener to the "sensor-reading-updated" CustomEvent broadcast by
 * sensorReadings.js. Every new reading triggers processSensorReading(), which
 * maintains the alerts collection automatically.
 *
 * Thresholds are loaded from Firestore in the background; any readings that
 * arrive before the fetch completes use the built-in default safe ranges.
 *
 * Call this once, before receiveSensorData(), so the listener is ready when the
 * first reading arrives.
 */
export function startAlertsEngine() {
    document.addEventListener("sensor-reading-updated", (e) => {
        processSensorReading(e.detail).catch(err =>
            console.error("[alertsEngine] Error processing reading:", err)
        );
    });

    // Load dynamic thresholds from Firestore in the background.
    loadThresholdsFromFirestore();

    // Expose on window so the console can confirm the engine loaded and started.
    window.alertsEngine = { processSensorReading };
    console.log("[alertsEngine] Started — listening for sensor-reading-updated events.");
}
