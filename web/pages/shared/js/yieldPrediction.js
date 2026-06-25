import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Sensor key list (matches Firestore schema) ────────────────────────────────
const SENSOR_KEYS = [
    "phLevel", "waterTemp", "dissolvedOxygen",
    "salinity", "turbidity", "waterLevel"
];

// ─── Per-parameter quality scorer (returns 0.0 – 1.0) ─────────────────────────
function scoreParam(key, value) {
    if (value == null || !Number.isFinite(Number(value))) return 0.5;
    const v = Number(value);
    switch (key) {
        case "phLevel":
            if (v >= 6.5 && v <= 8.5)                            return 1.0;
            if ((v >= 6.0 && v < 6.5) || (v > 8.5 && v <= 9.0)) return 0.6;
            return 0.3;
        case "waterTemp":
            if (v >= 22 && v <= 32)                               return 1.0;
            if ((v >= 18 && v < 22) || (v > 32 && v <= 36))      return 0.6;
            return 0.3;
        case "dissolvedOxygen":
            if (v >= 7)  return 1.0;
            if (v >= 5)  return 0.8;
            if (v >= 3)  return 0.5;
            return 0.2;
        case "salinity":
            if (v >= 0  && v <= 5)  return 1.0;
            if (v >  5  && v <= 10) return 0.7;
            if (v >  10 && v <= 15) return 0.5;
            return 0.3;
        case "turbidity":
            if (v <= 10) return 1.0;
            if (v <= 25) return 0.8;
            if (v <= 50) return 0.5;
            return 0.2;
        case "waterLevel":
            if (v >= 0.5 && v <= 2.0)                              return 1.0;
            if ((v >= 0.3 && v < 0.5) || (v > 2.0 && v <= 2.5))  return 0.7;
            return 0.4;
        default:
            return 0.5;
    }
}

// Average per-sensor scores, then map [0,1] → [0.5, 1.0] as specified
function calcWaterQualityScore(sensorData) {
    if (!sensorData) return 0.75;
    const scores = SENSOR_KEYS.map(k => scoreParam(k, sensorData[k]));
    const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
    return 0.5 + avg * 0.5;
}

// ─── Core yield & income formulas ──────────────────────────────────────────────
//  Base Yield (kg) = initialStock × (survivalRate/100) × avgWeightPerPiece(g) / 1000
//  Adjusted Yield  = Base Yield × Water Quality Score
//  Income range    = Adjusted Yield × (250 | 425 | 600)
function calcYield(growthData, wqScore) {
    const initialStock = Number(growthData.initialStock)      || 0;
    const survivalRate = Number(growthData.survivalRate)      || 0;
    const avgWeightG   = Number(growthData.avgWeightPerPiece) || 0;

    const baseYield     = initialStock * (survivalRate / 100) * (avgWeightG / 1000);
    const adjustedYield = baseYield * wqScore;

    return {
        initialStock,
        survivalRate,
        avgWeightG,
        baseYield,
        wqScore,
        adjustedYield,
        incomeMin: adjustedYield * 250,
        incomeAvg: adjustedYield * 425,
        incomeMax: adjustedYield * 600
    };
}

// ─── Formatting ────────────────────────────────────────────────────────────────
function fmt(n, d = 1) {
    return Number.isFinite(n) ? n.toFixed(d) : "--";
}

function fmtPeso(n) {
    return Number.isFinite(n) ? "₱" + Math.round(n).toLocaleString("en-PH") : "₱--";
}

function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function toDateValue(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
}

// ─── DOM render ────────────────────────────────────────────────────────────────
function updateUI(result, cycleData, sensorData) {
    // Cycle inputs
    setEl("yp-initial-stock", result.initialStock.toLocaleString("en-PH") + " pcs");
    setEl("yp-survival-rate", fmt(result.survivalRate, 1) + "%");
    setEl("yp-avg-weight",    fmt(result.avgWeightG, 0) + " g / pc");

    const harvestDate = toDateValue(cycleData.targetHarvestDate ?? cycleData.cycleEnd);
    setEl("yp-harvest-date", harvestDate
        ? harvestDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
        : "--");

    // Calculation steps
    setEl("yp-base-yield",     fmt(result.baseYield, 2) + " kg");
    setEl("yp-wq-score-label", "× " + fmt(result.wqScore, 2));
    setEl("yp-adjusted-yield", fmt(result.adjustedYield, 2) + " kg");

    // WQ score bar: maps [0.5, 1.0] → [0%, 100%]
    const pct      = ((result.wqScore - 0.5) / 0.5) * 100;
    const barColor = result.wqScore >= 0.85 ? "#059669"
                   : result.wqScore >= 0.70 ? "#d97706"
                   : "#dc2626";
    const bar      = document.getElementById("yp-wq-bar");
    const scoreEl  = document.getElementById("yp-wq-score-display");
    if (bar)     { bar.style.width = pct + "%"; bar.style.background = barColor; }
    if (scoreEl) { scoreEl.textContent = fmt(result.wqScore, 2); scoreEl.style.color = barColor; }

    // Big yield banner
    setEl("yp-yield-big", fmt(result.adjustedYield, 1) + " kg");

    // Income cards
    setEl("yp-income-min", fmtPeso(result.incomeMin));
    setEl("yp-income-avg", fmtPeso(result.incomeAvg));
    setEl("yp-income-max", fmtPeso(result.incomeMax));

    // Per-sensor score chips
    if (sensorData) {
        SENSOR_KEYS.forEach(key => {
            const score = scoreParam(key, sensorData[key]);
            const el    = document.getElementById("yp-sensor-" + key);
            if (!el) return;
            el.textContent = fmt(score, 2);
            el.className   = "yp-sb-score "
                + (score >= 0.85 ? "yp-good" : score >= 0.60 ? "yp-warn" : "yp-bad");
        });
    }

    // Timestamp
    const now = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    setEl("yp-last-updated", "Updated " + now);

    // Reveal section
    const section = document.getElementById("ypSection");
    if (section) section.classList.remove("yp-loading");

    // Keep the existing metric card in sync
    const yieldEl = document.getElementById("predictedYieldValue");
    const confEl  = document.getElementById("predictedYieldConfidence");
    if (yieldEl) yieldEl.textContent = fmt(result.adjustedYield, 1) + " kg";
    if (confEl)  confEl.textContent  = "WQ Score: " + fmt(result.wqScore, 2);
}

// ─── Public init ───────────────────────────────────────────────────────────────
export async function initYieldPrediction() {
    let growthData   = null;
    let latestSensor = window.latestSensorReading ?? null;

    // Fetch the most recent growth cycle once
    try {
        const snap = await getDocs(
            query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
        );
        if (!snap.empty) growthData = snap.docs[0].data();
    } catch (err) {
        console.warn("yieldPrediction: could not load growth_indicators:", err);
    }

    function recalculate() {
        if (!growthData) return;
        const result = calcYield(growthData, calcWaterQualityScore(latestSensor));
        updateUI(result, growthData, latestSensor);
        document.dispatchEvent(
            new CustomEvent("yield-prediction-updated", { detail: result })
        );
    }

    // Self-contained live sensor listener — works on any page
    try {
        onSnapshot(
            query(collection(db, "sensor_readings"), orderBy("timestamp", "desc"), limit(1)),
            snap => {
                if (snap.empty) return;
                latestSensor = snap.docs[0].data();
                recalculate();
            },
            err => console.warn("yieldPrediction: sensor_readings listener:", err)
        );
    } catch (err) {
        console.warn("yieldPrediction: could not start sensor listener:", err);
    }

    // Also react to the shared event fired by sensorReadings.js if it's loaded
    document.addEventListener("sensor-reading-updated", e => {
        latestSensor = e.detail;
        recalculate();
    });

    // Immediate first render with whatever data is available
    recalculate();
}
