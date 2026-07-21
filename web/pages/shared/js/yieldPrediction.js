import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    onSnapshot,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds } from "./thresholds.js";
import { SENSOR_KEYS, scoreParam, calcWaterQualityScore } from "./waterQualityScore.js";

// ─── Core yield & income formulas ──────────────────────────────────────────────
//  Yield (kg)   = initialStock × (survivalRate/100) × avgWeightPerPiece(g) / 1000
//  Income range = Yield × (250 | 425 | 600)
//  wqScore is carried through only for the separate Efficiency Score display
//  (analyticsRecommendations.js / analytics.js) — it no longer affects yield.
function calcYield(growthData, wqScore) {
    const initialStock = Number(growthData.initialStock)      || 0;
    const survivalRate = Number(growthData.survivalRate)      || 0;
    const avgWeightG   = Number(growthData.avgWeightPerPiece) || 0;

    const baseYield     = initialStock * (survivalRate / 100) * (avgWeightG / 1000);
    const adjustedYield = baseYield;

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

    // Estimated Harvest Date: cycleStart + 150 days (5-month cycle) — single
    // source shared by both the Yield Prediction card and the Growth/Survival
    // metric card so they can never disagree.
    const cycleStartDate = toDateValue(cycleData.cycleStart);
    const estHarvestDate = cycleStartDate
        ? new Date(cycleStartDate.getTime() + 150 * 24 * 60 * 60 * 1000)
        : null;
    const estHarvestDateStr = estHarvestDate
        ? estHarvestDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
        : "--";
    setEl("yp-harvest-date", estHarvestDateStr);
    setEl("harvest-date-value", estHarvestDateStr);

    // Calculation steps
    setEl("yp-base-yield", fmt(result.baseYield, 2) + " kg");

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
    if (confEl)  confEl.textContent  = "Based on current cycle data";
}

// ─── Public init ───────────────────────────────────────────────────────────────
export async function initYieldPrediction() {
    // Memoized — safe to call even if another module already triggered it.
    await loadThresholds();

    let growthData   = null;
    let latestSensor = window.latestSensorReading ?? null;

    // Fetch the most recent growth cycle once; sync expectedYield if stale/missing
    try {
        const snap = await getDocs(
            query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
        );
        if (!snap.empty) {
            const docSnap = snap.docs[0];
            growthData = docSnap.data();

            const computed = (Number(growthData.initialStock)      || 0)
                           * ((Number(growthData.survivalRate)     || 0) / 100)
                           * ((Number(growthData.avgWeightPerPiece) || 0) / 1000);
            const stored   = Number(growthData.expectedYield);

            if (!Number.isFinite(stored) || Math.abs(stored - computed) > 0.001) {
                updateDoc(docSnap.ref, { expectedYield: computed }).catch(err =>
                    console.warn("yieldPrediction: could not sync expectedYield:", err)
                );
            }
        }
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
