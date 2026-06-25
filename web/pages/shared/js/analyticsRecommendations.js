import { db } from './firebase.js';
import {
    collection, query, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Safe-range recommendation rules ──────────────────────────────────────
// Each rule's check() returns null when the parameter is in range,
// or { impact, category, title, desc } when action is needed.
const RULES = [
    {
        key: 'phLevel',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x < 6.0) return {
                impact: 'high', category: 'PH MANAGEMENT',
                title: 'Critical pH Drop — Immediate Action Needed',
                desc: `pH is at ${x.toFixed(1)} — critically low (safe range: 6.5–8.5). Apply agricultural lime or buffer solution immediately and suspend feeding until pH stabilizes above 6.5 to prevent ulang stress.`
            };
            if (x < 6.5) return {
                impact: 'medium', category: 'PH MANAGEMENT',
                title: 'pH Level Below Safe Range',
                desc: `pH at ${x.toFixed(1)} is slightly below the 6.5–8.5 optimal range. Gradually add pH buffer, reduce organic load, and increase water circulation to help stabilize levels.`
            };
            if (x > 9.0) return {
                impact: 'high', category: 'PH MANAGEMENT',
                title: 'Critical pH Spike — Immediate Water Exchange',
                desc: `pH at ${x.toFixed(1)} is critically high (safe range: 6.5–8.5). Perform a 20–25% partial water change immediately and check for algal bloom, which can cause rapid pH spikes.`
            };
            if (x > 8.5) return {
                impact: 'medium', category: 'PH MANAGEMENT',
                title: 'pH Slightly Elevated',
                desc: `pH at ${x.toFixed(1)} exceeds the 8.5 safe ceiling. Perform a 10–15% partial water exchange and monitor for algal activity, which drives pH up during daylight hours.`
            };
            return null;
        }
    },
    {
        key: 'waterTemp',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x < 18) return {
                impact: 'high', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Critically Low',
                desc: `Temperature at ${x.toFixed(1)}°C is critically low (safe: 22–32°C). Ulang metabolism slows significantly below 18°C, raising disease risk. Use heating elements and reduce water exchange to retain warmth.`
            };
            if (x < 22) return {
                impact: 'medium', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Below Optimal',
                desc: `Temperature at ${x.toFixed(1)}°C is below the 22–32°C safe range. Reduce water exchange volume, add transparent pond covers to trap solar heat, and shift feeding to warmer midday hours.`
            };
            if (x > 35) return {
                impact: 'high', category: 'TEMPERATURE CONTROL',
                title: 'Water Temperature Critically High',
                desc: `Temperature at ${x.toFixed(1)}°C is dangerously high. Activate emergency aeration immediately, install 50–70% shade netting, and perform a partial water exchange with cooler water to prevent mass mortality.`
            };
            if (x > 32) return {
                impact: 'medium', category: 'TEMPERATURE CONTROL',
                title: 'Elevated Water Temperature',
                desc: `Temperature at ${x.toFixed(1)}°C exceeds the 32°C ceiling. Increase shading coverage, boost aeration to offset reduced oxygen solubility at higher temperatures, and avoid feeding during peak afternoon heat.`
            };
            return null;
        }
    },
    {
        key: 'dissolvedOxygen',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x < 3) return {
                impact: 'high', category: 'OXYGEN MANAGEMENT',
                title: 'Critical Oxygen Depletion — Emergency Aeration',
                desc: `Dissolved oxygen at ${x.toFixed(1)} mg/L is critically low (minimum: 5 mg/L). Activate all aerators immediately, reduce feeding by 50%, and remove dead organic matter that consumes available oxygen.`
            };
            if (x < 5) return {
                impact: 'medium', category: 'OXYGEN MANAGEMENT',
                title: 'Dissolved Oxygen Below Safe Minimum',
                desc: `DO at ${x.toFixed(1)} mg/L is below the 5 mg/L safe minimum. Increase aerator speed by 30%, reduce daily feed volume, and inspect for algae overgrowth or organic decay consuming pond oxygen.`
            };
            return null;
        }
    },
    {
        key: 'salinity',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x > 10) return {
                impact: 'high', category: 'WATER QUALITY',
                title: 'Critically High Salinity for Freshwater Ulang',
                desc: `Salinity at ${x.toFixed(1)} ppt is far above the 0–5 ppt range. Perform a 30% fresh water exchange immediately and identify the source of salt intrusion (seawater contamination or excessive evaporation).`
            };
            if (x > 5) return {
                impact: 'medium', category: 'WATER QUALITY',
                title: 'Elevated Salinity Detected',
                desc: `Salinity at ${x.toFixed(1)} ppt exceeds the 5 ppt safe limit. Ulang are freshwater species sensitive to salt. Perform a gradual 15% fresh water exchange and monitor salinity closely over the next 24 hours.`
            };
            return null;
        }
    },
    {
        key: 'turbidity',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x > 50) return {
                impact: 'high', category: 'WATER QUALITY',
                title: 'Severely Turbid Water — Immediate Action',
                desc: `Turbidity at ${x.toFixed(1)} NTU is severely high (safe: below 25 NTU). Halt feeding to reduce waste accumulation, perform a partial water exchange, and check for algal bloom or disturbed pond sediment.`
            };
            if (x > 25) return {
                impact: 'medium', category: 'WATER QUALITY',
                title: 'High Turbidity Detected',
                desc: `Turbidity at ${x.toFixed(1)} NTU exceeds the 25 NTU safe limit. Reduce feeding rate by 20%, verify filtration is operating correctly, and inspect for suspended organic particles or sediment disturbance.`
            };
            return null;
        }
    },
    {
        key: 'waterLevel',
        check(v) {
            const x = parseFloat(v);
            if (!isFinite(x)) return null;
            if (x < 0.3) return {
                impact: 'high', category: 'POND MANAGEMENT',
                title: 'Water Level Critically Low',
                desc: `Water level at ${x.toFixed(2)} m is critically low (safe: 0.5–2.0 m). Add fresh water immediately to prevent heat stress, oxygen depletion from low water volume, and ulang attempting to escape the pond.`
            };
            if (x < 0.5) return {
                impact: 'medium', category: 'POND MANAGEMENT',
                title: 'Water Level Below Safe Minimum',
                desc: `Water level at ${x.toFixed(2)} m is below the 0.5 m minimum. Gradually add fresh water and inspect the pond for leaks or unusually high evaporation caused by heat and wind exposure.`
            };
            if (x > 2.5) return {
                impact: 'high', category: 'POND MANAGEMENT',
                title: 'Water Level Dangerously High',
                desc: `Water level at ${x.toFixed(2)} m exceeds the safe maximum of 2.0 m. Open drainage or activate pumping immediately to prevent overflow, which can lead to ulang escapes and reduced oxygen circulation.`
            };
            if (x > 2.0) return {
                impact: 'low', category: 'POND MANAGEMENT',
                title: 'Water Level Above Recommended Range',
                desc: `Water level at ${x.toFixed(2)} m slightly exceeds the 2.0 m recommended maximum. Gradually drain to the recommended level to ensure adequate oxygen circulation near the pond bottom.`
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

// ── Water Quality Score (mirrors yieldPrediction.js — no import to avoid coupling) ─
const SENSOR_KEYS = ['phLevel', 'waterTemp', 'dissolvedOxygen', 'salinity', 'turbidity', 'waterLevel'];

function scoreParam(key, value) {
    if (value == null || !isFinite(Number(value))) return 0.5;
    const v = Number(value);
    switch (key) {
        case 'phLevel':
            return (v >= 6.5 && v <= 8.5) ? 1.0 : ((v >= 6.0 && v < 6.5) || (v > 8.5 && v <= 9.0)) ? 0.6 : 0.3;
        case 'waterTemp':
            return (v >= 22 && v <= 32) ? 1.0 : ((v >= 18 && v < 22) || (v > 32 && v <= 36)) ? 0.6 : 0.3;
        case 'dissolvedOxygen':
            return v >= 7 ? 1.0 : v >= 5 ? 0.8 : v >= 3 ? 0.5 : 0.2;
        case 'salinity':
            return (v >= 0 && v <= 5) ? 1.0 : (v <= 10) ? 0.7 : (v <= 15) ? 0.5 : 0.3;
        case 'turbidity':
            return v <= 10 ? 1.0 : v <= 25 ? 0.8 : v <= 50 ? 0.5 : 0.2;
        case 'waterLevel':
            return (v >= 0.5 && v <= 2.0) ? 1.0 : ((v >= 0.3 && v < 0.5) || (v > 2.0 && v <= 2.5)) ? 0.7 : 0.4;
        default:
            return 0.5;
    }
}

function calcWQScore(sensor) {
    const avg = SENSOR_KEYS.reduce((sum, k) => sum + scoreParam(k, sensor[k]), 0) / SENSOR_KEYS.length;
    return 0.5 + avg * 0.5;
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
export function initAnalyticsRecommendations() {
    const q = query(collection(db, 'sensor_readings'), orderBy('timestamp', 'desc'), limit(1));

    onSnapshot(q, (snap) => {
        if (snap.empty) return;
        const sensor = snap.docs[0].data();
        renderRecommendations(generateRecommendations(sensor));
        updateEfficiencyCircle(calcWQScore(sensor));
    }, (err) => {
        console.error('analyticsRecommendations snapshot error:', err);
        const container = document.getElementById('rec-cards-container');
        if (container) container.innerHTML =
            `<p style="color:#dc2626;font-size:14px;grid-column:1/-1;padding:1rem;">
                Failed to load sensor data for recommendations (${err.code || err.message}).
            </p>`;
    });
}
