import { db } from './firebase.js';
import {
    collection, query, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { loadThresholds, getRanges } from './thresholds.js';
import { calcWaterQualityScore } from './waterQualityScore.js';

// One-decimal display formatting for parameters whose bounds are conventionally
// shown with a decimal place (pH, water level) — matches pre-refactor text exactly
// for default values (e.g. 2.0, not 2) and rounds sanely for admin-configured ones.
const fmt1 = (n) => Number(n).toFixed(1);

// ── Safe-range recommendation rules ──────────────────────────────────────
// Each rule's check() returns null when the parameter is in range,
// or { impact, category, title, desc } when action is needed.
// Bounds are read live from the shared thresholds module (getRanges()) rather
// than hardcoded, so both the branching cutoffs and the description text stay
// in sync with whatever an admin configures in Settings.
const RULES = [
    {
        key: 'phLevel',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { min, max } = getRanges().phLevel;
            const critLow  = min - 0.5;
            const critHigh = max + 0.5;
            const rangeStr = `${fmt1(min)}–${fmt1(max)}`;
            if (x < critLow) return {
                impact: 'high', category: 'PH MANAGEMENT',
                title: 'Critical pH Drop — Immediate Action Needed',
                desc: `pH is at ${x.toFixed(1)} — critically low (safe range: ${rangeStr}). Apply agricultural lime or buffer solution immediately and suspend feeding until pH stabilizes above ${fmt1(min)} to prevent ulang stress.`
            };
            if (x < min) return {
                impact: 'medium', category: 'PH MANAGEMENT',
                title: 'pH Level Below Safe Range',
                desc: `pH at ${x.toFixed(1)} is slightly below the ${rangeStr} optimal range. Gradually add pH buffer, reduce organic load, and increase water circulation to help stabilize levels.`
            };
            if (x > critHigh) return {
                impact: 'high', category: 'PH MANAGEMENT',
                title: 'Critical pH Spike — Immediate Water Exchange',
                desc: `pH at ${x.toFixed(1)} is critically high (safe range: ${rangeStr}). Perform a 20–25% partial water change immediately and check for algal bloom, which can cause rapid pH spikes.`
            };
            if (x > max) return {
                impact: 'medium', category: 'PH MANAGEMENT',
                title: 'pH Slightly Elevated',
                desc: `pH at ${x.toFixed(1)} exceeds the ${fmt1(max)} safe ceiling. Perform a 10–15% partial water exchange and monitor for algal activity, which drives pH up during daylight hours.`
            };
            return null;
        }
    },
    {
        key: 'waterTemp',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { min, max } = getRanges().waterTemp;
            const critLow  = min - 4;
            const critHigh = max + 3; // distinct from scoreParam's +4 tolerable-band edge — preserved as-is
            const rangeStr = `${min}–${max}°C`;
            if (x < critLow) return {
                impact: 'high', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Critically Low',
                desc: `Temperature at ${x.toFixed(1)}°C is critically low (safe: ${rangeStr}). Ulang metabolism slows significantly below ${critLow}°C, raising disease risk. Use heating elements and reduce water exchange to retain warmth.`
            };
            if (x < min) return {
                impact: 'medium', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Below Optimal',
                desc: `Temperature at ${x.toFixed(1)}°C is below the ${rangeStr} safe range. Reduce water exchange volume, add transparent pond covers to trap solar heat, and shift feeding to warmer midday hours.`
            };
            if (x > critHigh) return {
                impact: 'high', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Critically High',
                desc: `Temperature at ${x.toFixed(1)}°C is dangerously high. Activate emergency aeration immediately, install 50–70% shade netting, and perform a partial water exchange with cooler water to prevent mass mortality.`
            };
            if (x > max) return {
                impact: 'medium', category: 'TEMPERATURE CONTROL',
                title: 'Elevated Water Temperature',
                desc: `Temperature at ${x.toFixed(1)}°C exceeds the ${max}°C ceiling. Increase shading coverage, boost aeration to offset reduced oxygen solubility at higher temperatures, and avoid feeding during peak afternoon heat.`
            };
            return null;
        }
    },
    {
        key: 'dissolvedOxygen',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { min } = getRanges().dissolvedOxygen;
            const critLow = min - 2;
            if (x < critLow) return {
                impact: 'high', category: 'OXYGEN MANAGEMENT',
                title: 'Critical Oxygen Depletion — Emergency Aeration',
                desc: `Dissolved oxygen at ${x.toFixed(1)} mg/L is critically low (minimum: ${min} mg/L). Activate all aerators immediately, reduce feeding by 50%, and remove dead organic matter that consumes available oxygen.`
            };
            if (x < min) return {
                impact: 'medium', category: 'OXYGEN MANAGEMENT',
                title: 'Dissolved Oxygen Below Safe Minimum',
                desc: `DO at ${x.toFixed(1)} mg/L is below the ${min} mg/L safe minimum. Increase aerator speed by 30%, reduce daily feed volume, and inspect for algae overgrowth or organic decay consuming pond oxygen.`
            };
            return null;
        }
    },
    {
        key: 'salinity',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { max } = getRanges().salinity;
            const critHigh = max + 5;
            if (x > critHigh) return {
                impact: 'high', category: 'WATER QUALITY',
                title: 'Critically High Salinity for Freshwater Ulang',
                desc: `Salinity at ${x.toFixed(1)} ppt is far above the ${max} ppt safe limit. Perform a 30% fresh water exchange immediately and identify the source of salt intrusion (seawater contamination or excessive evaporation).`
            };
            if (x > max) return {
                impact: 'medium', category: 'WATER QUALITY',
                title: 'Elevated Salinity Detected',
                desc: `Salinity at ${x.toFixed(1)} ppt exceeds the ${max} ppt safe limit. Ulang are freshwater species sensitive to salt. Perform a gradual 15% fresh water exchange and monitor salinity closely over the next 24 hours.`
            };
            return null;
        }
    },
    {
        key: 'turbidity',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { max } = getRanges().turbidity;
            const critHigh = max + 25;
            if (x > critHigh) return {
                impact: 'high', category: 'WATER QUALITY',
                title: 'Severely Turbid Water — Immediate Action',
                desc: `Turbidity at ${x.toFixed(1)} NTU is severely high (safe: below ${max} NTU). Halt feeding to reduce waste accumulation, perform a partial water exchange, and check for algal bloom or disturbed pond sediment.`
            };
            if (x > max) return {
                impact: 'medium', category: 'WATER QUALITY',
                title: 'High Turbidity Detected',
                desc: `Turbidity at ${x.toFixed(1)} NTU exceeds the ${max} NTU safe limit. Reduce feeding rate by 20%, verify filtration is operating correctly, and inspect for suspended organic particles or sediment disturbance.`
            };
            return null;
        }
    },
    {
        key: 'waterLevel',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            const { min, max } = getRanges().waterLevel;
            const critLow  = min - 0.2;
            const critHigh = max + 0.5;
            const rangeStr = `${fmt1(min)}–${fmt1(max)}`;
            if (x < critLow) return {
                impact: 'high', category: 'POND MANAGEMENT',
                title: 'Water Level Critically Low',
                desc: `Water level at ${x.toFixed(2)} m is critically low (safe: ${rangeStr} m). Add fresh water immediately to prevent heat stress, oxygen depletion from low water volume, and ulang attempting to escape the pond.`
            };
            if (x < min) return {
                impact: 'medium', category: 'POND MANAGEMENT',
                title: 'Water Level Below Safe Minimum',
                desc: `Water level at ${x.toFixed(2)} m is below the ${fmt1(min)} m minimum. Gradually add fresh water and inspect the pond for leaks or unusually high evaporation caused by heat and wind exposure.`
            };
            if (x > critHigh) return {
                impact: 'high', category: 'POND MANAGEMENT',
                title: 'Water Level Dangerously High',
                desc: `Water level at ${x.toFixed(2)} m exceeds the safe maximum of ${fmt1(max)} m. Open drainage or activate pumping immediately to prevent overflow, which can lead to ulang escapes and reduced oxygen circulation.`
            };
            if (x > max) return {
                impact: 'low', category: 'POND MANAGEMENT',
                title: 'Water Level Above Recommended Range',
                desc: `Water level at ${x.toFixed(2)} m slightly exceeds the ${fmt1(max)} m recommended maximum. Gradually drain to the recommended level to ensure adequate oxygen circulation near the pond bottom.`
            };
            return null;
        }
    }
];

// ── Generate sorted recommendation list from a sensor reading ─────────────
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };

function generateRecommendations(sensor) {
    const recs = [];
    for (const rule of RULES) {
        const val = sensor[rule.key];
        if (val == null) continue;
        const result = rule.check(val);
        if (result) recs.push(result);
    }
    recs.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
    return recs;
}

// ── Build a single recommendation card element ────────────────────────────
const IMPACT_LABELS = { high: 'High IMPACT', medium: 'Medium IMPACT', low: 'Low IMPACT' };

function buildCard(rec) {
    const card = document.createElement('div');
    card.className = 'rec-card';
    card.innerHTML = `
        <div class="rec-card-head">
            <span class="rec-impact ${rec.impact}">${IMPACT_LABELS[rec.impact]}</span>
            <span class="rec-category">${rec.category}</span>
        </div>
        <h3 class="rec-card-title">${rec.title}</h3>
        <p class="rec-card-desc">${rec.desc}</p>
    `;
    return card;
}

// ── Render cards into #rec-cards-container ────────────────────────────────
function renderRecommendations(recs) {
    const container = document.getElementById('rec-cards-container');
    if (!container) return;
    container.innerHTML = '';

    if (recs.length === 0) {
        const card = document.createElement('div');
        card.className = 'rec-card rec-card-all-clear';
        card.innerHTML = `
            <div class="rec-card-head">
                <span class="rec-impact-ok">All Clear</span>
                <span class="rec-category">SYSTEM STATUS</span>
            </div>
            <h3 class="rec-card-title">All Parameters Within Safe Range</h3>
            <p class="rec-card-desc">All monitored water quality parameters are currently within optimal ranges for ulang cultivation. Continue current management practices and schedule routine maintenance checks.</p>
        `;
        container.appendChild(card);
        return;
    }

    for (const rec of recs) container.appendChild(buildCard(rec));
}

// ── Update the efficiency donut circle ────────────────────────────────────
function updateEfficiencyCircle(wqScore) {
    const pct    = Math.round(wqScore * 100);
    const deg    = ((pct / 100) * 360).toFixed(1);
    const color  = pct >= 85 ? '#10b981' : pct >= 70 ? '#d97706' : '#ef4444';
    const status = pct >= 85 ? 'OPTIMAL' : pct >= 70 ? 'GOOD' : pct >= 60 ? 'FAIR' : 'POOR';

    const outer = document.getElementById('eff-circle-outer');
    if (outer) outer.style.background =
        `conic-gradient(${color} 0deg ${deg}deg, #e5e7eb ${deg}deg 360deg)`;

    const valEl = document.getElementById('eff-value');
    if (valEl) valEl.textContent = pct + '%';

    const statusEl = document.getElementById('eff-status');
    if (statusEl) statusEl.textContent = status;

    const descEl = document.getElementById('eff-desc');
    if (descEl) {
        const note = pct >= 85
            ? `System is operating at <strong>peak efficiency</strong> for ulang cultivation.`
            : pct >= 70
            ? `System is performing <strong>adequately</strong> — address alerts to reach optimal.`
            : `System needs <strong>immediate attention</strong> — multiple parameters out of range.`;
        descEl.innerHTML = `Water Quality Score: ${wqScore.toFixed(2)} (${pct}%). ${note}`;
    }
}

// ── Public init: subscribe to latest sensor reading ───────────────────────
export async function initAnalyticsRecommendations() {
    // Memoized — safe to call even if another module already triggered it.
    await loadThresholds();

    const q = query(collection(db, 'sensor_readings'), orderBy('timestamp', 'desc'), limit(1));

    onSnapshot(q, (snap) => {
        if (snap.empty) return;
        const sensor = snap.docs[0].data();
        renderRecommendations(generateRecommendations(sensor));
        updateEfficiencyCircle(calcWaterQualityScore(sensor));
    }, (err) => {
        console.error('analyticsRecommendations snapshot error:', err);
        const container = document.getElementById('rec-cards-container');
        if (container) container.innerHTML =
            `<p style="color:#dc2626;font-size:14px;grid-column:1/-1;padding:1rem;">
                Failed to load sensor data for recommendations (${err.code || err.message}).
            </p>`;
    });
}
