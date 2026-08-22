import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds } from "./thresholds.js";
import { SENSOR_KEYS, scoreParam, calcWaterQualityScore } from "./waterQualityScore.js";
import { AQUAPONICS_REF, normalizeAquaponicsReading } from "./aquaponicsReading.js";

// ─── Core yield & income formulas ──────────────────────────────────────────────
//  Yield (kg)   = RF-projected harvest weight × survivalRate × initialStock
//  (see ml-analytics/predict_yield.py). No formula fallback — if RF hasn't
//  produced a prediction for this cycle yet, adjustedYield is null and the
//  UI shows a "being processed" state instead of a number.
//  Income range = Yield × (150 | 300 | 450)
//  Revenue prices based on BFAR National Consolidated Price Monitoring Report 2025;
//  provincial-adjusted for Hagonoy, Bulacan (non-NCR).
//  Profit (est) = incomeAvg − (Yield × costPerKg); costPerKg is a user-set
//  placeholder from growth_indicators, so profit/cost are always estimates.
//  wqScore is carried through only for the separate Efficiency Score display
//  (analyticsRecommendations.js / analytics.js) — it no longer affects yield.
const DEFAULT_COST_PER_KG = 250;
const INCOME_MIN_RATE = 150;
const INCOME_AVG_RATE = 300;
const INCOME_MAX_RATE = 450;
// Panelist requirement: yield prediction only after 3 months of real cultivation data
const RF_GATE_DAYS = 90;

function calcYield(growthData, wqScore) {
    const initialStock = Number(growthData.initialStock) || 0;
    const survivalRate = Number(growthData.survivalRate) || 0;
    const costPerKg     = Number(growthData.costPerKg) > 0 ? Number(growthData.costPerKg) : DEFAULT_COST_PER_KG;

    // Panelist requirement: no yield prediction until the cycle has run for
    // RF_GATE_DAYS. Folded directly into eligibility so a stale
    // rfProjectedYield already sitting in Firestore from before this gate
    // existed can't slip through. Missing cycleStart fails closed.
    const cycleStartDate = toDateValue(growthData.cycleStart);
    const daysSinceCycleStart = cycleStartDate
        ? (Date.now() - cycleStartDate.getTime()) / (24 * 60 * 60 * 1000)
        : null;
    const eligible = daysSinceCycleStart != null && daysSinceCycleStart >= RF_GATE_DAYS;
    const weeksRemaining = (!eligible && daysSinceCycleStart != null)
        ? Math.ceil((RF_GATE_DAYS - daysSinceCycleStart) / 7)
        : null;

    // RF batch-inference fields (written together by ml-analytics/predict_yield.py).
    // rfProjectedYield is the ONLY yield source now — no formula fallback. If
    // the RF script hasn't run yet (or the cycle isn't eligible), adjustedYield
    // is null and updateUI() shows a "being processed" state instead.
    const rfProjectedYield = Number(growthData.rfProjectedYield);
    const rfAvailable      = eligible && Number.isFinite(rfProjectedYield) && rfProjectedYield > 0;
    const adjustedYield    = rfAvailable ? rfProjectedYield : null;

    // Null, not 0 — adjustedYield * RATE would otherwise coerce to a
    // misleading 0 (JS treats null as 0 in arithmetic), not "no data."
    const incomeMin     = adjustedYield != null ? adjustedYield * INCOME_MIN_RATE : null;
    const incomeAvg     = adjustedYield != null ? adjustedYield * INCOME_AVG_RATE : null;
    const incomeMax     = adjustedYield != null ? adjustedYield * INCOME_MAX_RATE : null;
    const estimatedCost = adjustedYield != null ? adjustedYield * costPerKg : null;
    const netProfit      = (incomeAvg != null && estimatedCost != null) ? incomeAvg - estimatedCost : null;

    return {
        initialStock,
        survivalRate,
        wqScore,
        eligible,
        weeksRemaining,
        adjustedYield,
        costPerKg,
        incomeMin,
        incomeAvg,
        incomeMax,
        estimatedCost,
        netProfit,
        rfAvailable,
        rfMode: rfAvailable ? (growthData.rfMode ?? null) : null,
        rfNote: rfAvailable ? (growthData.rfNote ?? "") : "",
        rfReadingsUsed: rfAvailable && Number.isFinite(Number(growthData.rfReadingsUsed))
            ? Number(growthData.rfReadingsUsed) : null,
        rfUpdatedAt: rfAvailable ? (growthData.rfUpdatedAt ?? null) : null
    };
}

const RF_MODE_LABELS = {
    hybrid: "RF Prediction — Hybrid",
    real:   "RF Prediction — Real",
    test:   "RF Prediction — Test"
};

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
    setEl("harvest-date-value", estHarvestDateStr);

    if (!result.eligible) {
        // State (a): not enough cultivation time has elapsed to trust any
        // prediction yet.
        const pendingMsg = result.weeksRemaining != null
            ? `Prediction available in ${result.weeksRemaining} week${result.weeksRemaining === 1 ? "" : "s"}`
            : "Prediction pending — cycle start date not set";

        setEl("yp-yield-big", "Pending");
        setEl("yp-yield-sub", pendingMsg);

        const modeBadge = document.getElementById("yp-rf-mode-badge");
        if (modeBadge) {
            modeBadge.textContent = "Pending";
            modeBadge.className   = "yp-rf-mode-badge is-fallback";
        }
        setEl("yp-rf-note", "");
        setEl("yp-rf-readings", "");
        setEl("yp-rf-updated", "");

        setEl("yp-income-min", "₱--");
        setEl("yp-income-avg", "₱--");
        setEl("yp-income-max", "₱--");
        setEl("yp-estimated-cost", "₱--");
        setEl("yp-net-profit", "₱--");
        setEl("yp-cost-per-kg-rate", "--");

        setEl("predictedYieldValue", "Pending");
        setEl("predictedYieldConfidence", pendingMsg);
    } else if (result.rfAvailable) {
        // State (b): eligible AND RF has produced a usable prediction.
        setEl("yp-yield-big", fmt(result.adjustedYield, 1) + " kg");
        setEl("yp-yield-sub", "Random Forest projection from live sensor data");

        const modeBadge = document.getElementById("yp-rf-mode-badge");
        if (modeBadge) {
            modeBadge.textContent = RF_MODE_LABELS[result.rfMode] || "RF Prediction";
            modeBadge.className   = "yp-rf-mode-badge is-rf is-" + (result.rfMode || "unknown");
        }
        setEl("yp-rf-note", result.rfNote);
        setEl("yp-rf-readings", result.rfReadingsUsed != null
            ? "Based on " + result.rfReadingsUsed.toLocaleString("en-PH") + " sensor readings"
            : "");
        const rfUpdatedDate = toDateValue(result.rfUpdatedAt);
        setEl("yp-rf-updated", rfUpdatedDate
            ? "Last updated: " + rfUpdatedDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
            : "");

        setEl("yp-income-min", fmtPeso(result.incomeMin));
        setEl("yp-income-avg", fmtPeso(result.incomeAvg));
        setEl("yp-income-max", fmtPeso(result.incomeMax));
        setEl("yp-estimated-cost", fmtPeso(result.estimatedCost));
        setEl("yp-net-profit", fmtPeso(result.netProfit));
        setEl("yp-cost-per-kg-rate", "at ₱" + fmt(result.costPerKg, 0) + " / kg (estimated)");

        setEl("predictedYieldValue", fmt(result.adjustedYield, 1) + " kg");
        setEl("predictedYieldConfidence", RF_MODE_LABELS[result.rfMode] || "RF Prediction");
    } else {
        // State (c): eligible, but RF hasn't produced a usable prediction for
        // this cycle yet. Distinct from (a) — this is an operational wait
        // (predict_yield.py needs to run), not a data-age countdown, so no
        // "weeks remaining" applies here.
        setEl("yp-yield-big", "Prediction being processed");
        setEl("yp-yield-sub", "The RF model hasn't produced a prediction for this cycle yet");

        const modeBadge = document.getElementById("yp-rf-mode-badge");
        if (modeBadge) {
            modeBadge.textContent = "Processing";
            modeBadge.className   = "yp-rf-mode-badge is-fallback";
        }
        setEl("yp-rf-note", "");
        setEl("yp-rf-readings", "");
        setEl("yp-rf-updated", "");

        setEl("yp-income-min", "₱--");
        setEl("yp-income-avg", "₱--");
        setEl("yp-income-max", "₱--");
        setEl("yp-estimated-cost", "₱--");
        setEl("yp-net-profit", "₱--");
        setEl("yp-cost-per-kg-rate", "--");

        setEl("predictedYieldValue", "--");
        setEl("predictedYieldConfidence", "--");
    }

    // Per-sensor score chips
    if (sensorData) {
        SENSOR_KEYS.forEach(key => {
            const score = scoreParam(key, sensorData[key]);
            const el    = document.getElementById("yp-sensor-" + key);
            if (!el) return;

            // scoreParam() is binary now: 1 (in range), 0 (out of range), or
            // null (missing/unjudgeable) — show the fact directly instead of
            // a decimal, and use the base .yp-sb-score neutral color for null
            // so a missing reading doesn't look like an out-of-range failure.
            if (score == null) {
                el.textContent = "--";
                el.className   = "yp-sb-score";
            } else {
                const inRange = score === 1;
                el.textContent = inRange ? "In Range" : "Out of Range";
                el.className   = "yp-sb-score " + (inRange ? "yp-good" : "yp-bad");
            }
        });
    }

    // Timestamp
    const now = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    setEl("yp-last-updated", "Updated " + now);

    // Reveal section
    const section = document.getElementById("ypSection");
    if (section) section.classList.remove("yp-loading");
}

// ─── Public init ───────────────────────────────────────────────────────────────
export async function initYieldPrediction() {
    // Memoized — safe to call even if another module already triggered it.
    await loadThresholds();

    let growthData   = null;
    let latestSensor = window.latestSensorReading ?? null;

    // Fetch the most recent growth cycle once.
    try {
        const snap = await getDocs(
            query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
        );
        if (!snap.empty) {
            growthData = snap.docs[0].data();
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
            AQUAPONICS_REF,
            snap => {
                if (!snap.exists()) return;
                latestSensor = normalizeAquaponicsReading(snap.data());
                recalculate();
            },
            err => console.warn("yieldPrediction: Aquaponics/Ulang listener:", err)
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
