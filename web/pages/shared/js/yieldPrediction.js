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
import { AQUAPONICS_REF, normalizeAquaponicsReading } from "./aquaponicsReading.js";

// ─── Core yield & income formulas ──────────────────────────────────────────────
//  Yield (kg)   = initialStock × (survivalRate/100) × avgWeightPerPiece(g) / 1000
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
    const initialStock = Number(growthData.initialStock)      || 0;
    const survivalRate = Number(growthData.survivalRate)      || 0;
    const avgWeightG   = Number(growthData.avgWeightPerPiece) || 0;
    const costPerKg     = Number(growthData.costPerKg) > 0 ? Number(growthData.costPerKg) : DEFAULT_COST_PER_KG;

    const baseYield     = initialStock * (survivalRate / 100) * (avgWeightG / 1000);

    // Panelist requirement: no yield prediction — RF OR formula — until the
    // cycle has run for RF_GATE_DAYS. Folded directly into eligibility so a
    // stale rfProjectedYield already sitting in Firestore from before this
    // gate existed can't slip through. Missing cycleStart fails closed.
    const cycleStartDate = toDateValue(growthData.cycleStart);
    const daysSinceCycleStart = cycleStartDate
        ? (Date.now() - cycleStartDate.getTime()) / (24 * 60 * 60 * 1000)
        : null;
    const eligible = daysSinceCycleStart != null && daysSinceCycleStart >= RF_GATE_DAYS;
    const weeksRemaining = (!eligible && daysSinceCycleStart != null)
        ? Math.ceil((RF_GATE_DAYS - daysSinceCycleStart) / 7)
        : null;

    // RF batch-inference fields (written together by ml-analytics/predict_yield.py).
    // rfProjectedYield presence is the single availability gate — if the RF script
    // hasn't run yet, this is NaN and everything below falls back to the formula.
    const rfProjectedYield = Number(growthData.rfProjectedYield);
    const rfAvailable      = eligible && Number.isFinite(rfProjectedYield) && rfProjectedYield > 0;

    const adjustedYield = rfAvailable ? rfProjectedYield : baseYield;
    const finalWeight   = rfAvailable ? Number(growthData.rfProjectedWeight) : avgWeightG;

    const incomeAvg      = adjustedYield * INCOME_AVG_RATE;
    const estimatedCost  = adjustedYield * costPerKg;
    const netProfit       = incomeAvg - estimatedCost;

    return {
        initialStock,
        survivalRate,
        avgWeightG,
        baseYield,
        wqScore,
        eligible,
        weeksRemaining,
        adjustedYield,
        finalWeight,
        costPerKg,
        incomeMin: adjustedYield * INCOME_MIN_RATE,
        incomeAvg,
        incomeMax: adjustedYield * INCOME_MAX_RATE,
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
        // Panelist gate: suppress the ENTIRE yield display — RF and formula
        // fallback alike — until RF_GATE_DAYS have passed. Neither number is
        // backed by real cultivation data yet.
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
    } else {
        // Big yield banner (RF-based when available, formula fallback otherwise)
        setEl("yp-yield-big", fmt(result.adjustedYield, 1) + " kg");
        setEl("yp-yield-sub", result.rfAvailable
            ? "Random Forest projection from live sensor data"
            : "Based on stock, survival rate & weight per piece (formula estimate)");

        // RF mode badge + metadata
        const modeBadge = document.getElementById("yp-rf-mode-badge");
        if (modeBadge) {
            if (result.rfAvailable) {
                modeBadge.textContent = RF_MODE_LABELS[result.rfMode] || "RF Prediction";
                modeBadge.className   = "yp-rf-mode-badge is-rf is-" + (result.rfMode || "unknown");
            } else {
                modeBadge.textContent = "Formula Estimate";
                modeBadge.className   = "yp-rf-mode-badge is-fallback";
            }
        }
        setEl("yp-rf-note", result.rfAvailable ? result.rfNote : "");
        setEl("yp-rf-readings", result.rfAvailable && result.rfReadingsUsed != null
            ? "Based on " + result.rfReadingsUsed.toLocaleString("en-PH") + " sensor readings"
            : "");
        const rfUpdatedDate = result.rfAvailable ? toDateValue(result.rfUpdatedAt) : null;
        setEl("yp-rf-updated", rfUpdatedDate
            ? "Last updated: " + rfUpdatedDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
            : "");

        // Income cards
        setEl("yp-income-min", fmtPeso(result.incomeMin));
        setEl("yp-income-avg", fmtPeso(result.incomeAvg));
        setEl("yp-income-max", fmtPeso(result.incomeMax));

        // Profit estimate (cost per kg is a user-set placeholder — always labeled "estimated")
        setEl("yp-estimated-cost", fmtPeso(result.estimatedCost));
        setEl("yp-net-profit", fmtPeso(result.netProfit));
        setEl("yp-cost-per-kg-rate", "at ₱" + fmt(result.costPerKg, 0) + " / kg (estimated)");

        // Keep the existing metric card in sync
        setEl("predictedYieldValue", fmt(result.adjustedYield, 1) + " kg");
        setEl("predictedYieldConfidence", result.rfAvailable
            ? (RF_MODE_LABELS[result.rfMode] || "RF Prediction")
            : "Formula estimate — current cycle data");
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
