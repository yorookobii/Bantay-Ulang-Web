import { auth, db } from './firebase.js';
import {
    doc, getDoc, setDoc, deleteField,
    collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initSidebar } from './sidebar.js';
import { reevaluateActiveAlerts } from './alertsEngine.js';

const THRESHOLDS_DOC = doc(db, 'settings', 'thresholds');

// ── Shared confirm modal ──────────────────────────────────────────────────────

const confirmOverlay = document.getElementById('confirmModalOverlay');
const confirmTitleEl = document.getElementById('confirmModalTitle');
const confirmMsgEl   = document.getElementById('confirmModalMsg');
const confirmBtn     = document.getElementById('confirmModalConfirm');
const cancelBtn      = document.getElementById('confirmModalCancel');
let pendingConfirmResolve = null;

function confirmDialog(title, message) {
    if (pendingConfirmResolve) return Promise.resolve(false);
    return new Promise((resolve) => {
        pendingConfirmResolve = resolve;
        if (confirmTitleEl) confirmTitleEl.textContent = title;
        if (confirmMsgEl) confirmMsgEl.textContent = message;
        if (confirmOverlay) {
            confirmOverlay.classList.add('show');
            confirmOverlay.setAttribute('aria-hidden', 'false');
        }
    });
}

function closeConfirmDialog(result) {
    if (confirmOverlay) {
        confirmOverlay.classList.remove('show');
        confirmOverlay.setAttribute('aria-hidden', 'true');
    }
    if (pendingConfirmResolve) {
        const resolve = pendingConfirmResolve;
        pendingConfirmResolve = null;
        resolve(result);
    }
}

if (confirmBtn) confirmBtn.addEventListener('click', () => closeConfirmDialog(true));
if (cancelBtn) cancelBtn.addEventListener('click', () => closeConfirmDialog(false));
if (confirmOverlay) confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirmDialog(false);
});

const FIELDS = [
    'ph_min', 'ph_max',
    'temp_min', 'temp_max',
    'o2_min',
    'salinity_min', 'salinity_max',
    'turbidity_max',
    'waterlevel_min', 'waterlevel_max',
    'tds_min', 'tds_max'
];

// ── Load thresholds from Firestore into the form ─────────────────────────────

async function loadThresholds() {
    try {
        const snap = await getDoc(THRESHOLDS_DOC);
        if (!snap.exists()) return;
        const data = snap.data();
        FIELDS.forEach(name => {
            const el = document.getElementById(name);
            if (el && data[name] != null) el.value = data[name];
        });
    } catch (err) {
        console.warn('[settings] Could not load thresholds from Firestore:', err);
    }
}

// ── Save thresholds to Firestore ─────────────────────────────────────────────

async function saveThresholds() {
    const data = {};
    FIELDS.forEach(name => {
        const el = document.getElementById(name);
        if (el && el.value !== '') data[name] = parseFloat(el.value);
    });
    await setDoc(THRESHOLDS_DOC, data, { merge: true });
    await reevaluateActiveAlerts();
}

// ── Form submit handler ───────────────────────────────────────────────────────

const form  = document.getElementById('threshold-form');
const msgEl = document.getElementById('threshold-saved-msg');

if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await confirmDialog('Save changes?', 'Are you sure you want to save these changes?');
        if (!ok) return;
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            await saveThresholds();
            if (msgEl) {
                msgEl.textContent = 'Thresholds saved successfully.';
                msgEl.classList.add('show');
                setTimeout(() => msgEl.classList.remove('show'), 3000);
            }
        } catch (err) {
            console.error('[settings] Save failed:', err);
            if (msgEl) {
                msgEl.textContent = 'Failed to save. Check your connection and try again.';
                msgEl.style.color = '#dc2626';
                msgEl.classList.add('show');
                setTimeout(() => { msgEl.classList.remove('show'); msgEl.style.color = ''; }, 4000);
            }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '✓ Save thresholds'; }
        }
    });
}

// ── Growth Parameters ─────────────────────────────────────────────────────────

// Ulang grow-out period — matches yieldPrediction.js's harvest-date computation
// so web and Flutter (which reads stored cycleEnd) agree.
const GROWOUT_DAYS = 150;

// Optional stocking weights in grams, ordered min, median, max.
const STOCKING_WEIGHT_IDS = ['gi_stockingWeightMin', 'gi_stockingWeight', 'gi_stockingWeightMax'];
const STOCKING_WEIGHT_MIN_G = 0.1;
const STOCKING_WEIGHT_MAX_G = 500;
// Fields predict_yield.py writes for a cycle; cleared when the cycle start changes.
const RF_PREDICTION_FIELDS = [
    'rfProjectedWeight', 'rfProjectedYield', 'rfMode', 'rfNote', 'rfUpdatedAt',
    'rfWaterSource', 'rfWaterFrom', 'rfWaterTo', 'rfReadingsUsed', 'rfBackfillDaysRemaining',
];

const GROWTH_PARAM_IDS = ['gi_initialStock', ...STOCKING_WEIGHT_IDS];
const GROWTH_FIELD_MAP = {
    gi_initialStock: 'initialStock',
    gi_stockingWeightMin: 'stockingWeightMin',
    gi_stockingWeight: 'stockingWeight',
    gi_stockingWeightMax: 'stockingWeightMax',
};
let growthDocRef = null;
let loadedCycleStart = null;

async function loadGrowthParams() {
    try {
        const snap = await getDocs(
            query(collection(db, 'growth_indicators'), orderBy('timestamp', 'desc'), limit(1))
        );
        if (!snap.empty) {
            growthDocRef = snap.docs[0].ref;
            const data   = snap.docs[0].data();
            GROWTH_PARAM_IDS.forEach(id => {
                const el    = document.getElementById(id);
                const field = GROWTH_FIELD_MAP[id];
                if (el && data[field] != null) el.value = data[field];
            });

            const cycleStartEl = document.getElementById('gi_cycleStart');
            if (cycleStartEl && data.cycleStart?.toDate) {
                // Local getters, not toISOString() (which is UTC) — the save path
                // writes local midnight (new Date(val + 'T00:00:00')), so the loader
                // must read back in local time too or the date box drifts by a day.
                const d = data.cycleStart.toDate();
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                cycleStartEl.value = iso;
                loadedCycleStart = iso;
                loadStockingHint(d);
            }
            // One-time check: confirm the latest-by-timestamp doc actually carries
            // cycleStart (a manually-added field on an older doc would never surface here).
            console.log('[settings] latest growth_indicators doc has cycleStart:', data.cycleStart != null, data.cycleStart?.toDate?.());
        }
    } catch (err) {
        console.warn('[settings] Could not load growth_indicators:', err);
    }
}

// Stocking weights by field name (null when blank); throws with a user-facing message when invalid.
function readStockingWeights() {
    const weights = {};
    for (const id of STOCKING_WEIGHT_IDS) {
        const raw = document.getElementById(id)?.value.trim();
        const g = raw ? Number(raw) : null;
        if (g !== null && !(g >= STOCKING_WEIGHT_MIN_G && g <= STOCKING_WEIGHT_MAX_G)) {
            throw new Error(`Stocking weights must be between ${STOCKING_WEIGHT_MIN_G} and ${STOCKING_WEIGHT_MAX_G} g.`);
        }
        weights[GROWTH_FIELD_MAP[id]] = g;
    }
    const filled = [weights.stockingWeightMin, weights.stockingWeight, weights.stockingWeightMax].filter(g => g !== null);
    if (filled.some((g, i) => i > 0 && g < filled[i - 1])) {
        throw new Error('Stocking weights must go min ≤ median ≤ max.');
    }
    return weights;
}

// ── Stocking weight hint from logged samples ──────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HINT_MAX_READS = 300;        // safety cap on documents read per hint query
const HINT_LAST_USABLE_WEEK = 2;   // later weeks reflect growth, not stocking size
const HINT_SMALL_SAMPLE = 10;
let hintCycleStartMs = null;
let hintStats = null;

const round1 = (g) => Number(g.toFixed(1));

// Raw stats of the earliest logged week, unfiltered because the weight flags depend on the stocking weight itself.
async function earliestWeekStats(cycleStart) {
    const [{ loadWeightSamples }, { median }] = await Promise.all([import('./avgWeightChart.js'), import('./reportCleanup.js')]);
    const weekEnd = (week) => new Date(cycleStart.getTime() + week * WEEK_MS);
    let samples = await loadWeightSamples(cycleStart, { until: weekEnd(1), max: HINT_MAX_READS });
    if (!samples.length) {
        const [first] = await loadWeightSamples(cycleStart, { max: 1 });
        if (!first) return null;
        samples = await loadWeightSamples(cycleStart, { until: weekEnd(first.week), max: HINT_MAX_READS });
    }
    const weights = samples.map(s => s.weightG).filter(g => g > 0);
    if (!weights.length) return null;
    return { week: samples[0].week, n: weights.length, median: median(weights), min: Math.min(...weights), max: Math.max(...weights) };
}

// Shows the earliest-week stats under the stocking fields; a failed load only hides the hint.
async function loadStockingHint(cycleStart) {
    const hintEl   = document.getElementById('stocking-hint');
    const textEl   = document.getElementById('stocking-hint-text');
    const useBtn   = document.getElementById('stocking-hint-use');
    const statusEl = document.getElementById('stocking-hint-status');
    if (!hintEl || !textEl || !useBtn) return;
    const startMs = cycleStart.getTime();
    hintCycleStartMs = startMs;
    try {
        const stats = await earliestWeekStats(cycleStart);
        if (hintCycleStartMs !== startMs) return; // a newer load replaced this one
        const usable = stats !== null && stats.week <= HINT_LAST_USABLE_WEEK;
        if (!stats) {
            textEl.textContent = 'No weight logs this cycle yet.';
        } else {
            const label = stats.week === 1 ? 'Week 1 from logs' : `Week ${stats.week} from logs (no week 1 samples)`;
            const notes = [`n = ${stats.n}`, `range ${round1(stats.min)}–${round1(stats.max)} g`];
            if (stats.n < HINT_SMALL_SAMPLE) notes.push('small sample');
            textEl.textContent = `${label}: median ${round1(stats.median)} g (${notes.join(', ')})`
                + (usable ? '' : '. Too late in the cycle to use as stocking weight.');
        }
        hintStats = usable ? stats : null;
        useBtn.hidden = !usable;
        if (statusEl) statusEl.textContent = '';
        hintEl.hidden = false;
    } catch (err) {
        if (hintCycleStartMs === startMs) hintEl.hidden = true;
        console.warn('[settings] Stocking hint unavailable:', err);
    }
}

// Fills the three stocking inputs only; saving stays with the form's Save button.
document.getElementById('stocking-hint-use')?.addEventListener('click', () => {
    if (!hintStats) return;
    [['gi_stockingWeightMin', hintStats.min], ['gi_stockingWeight', hintStats.median], ['gi_stockingWeightMax', hintStats.max]].forEach(([id, g]) => {
        const el = document.getElementById(id);
        if (el) el.value = round1(g);
    });
    const statusEl = document.getElementById('stocking-hint-status');
    if (statusEl) statusEl.textContent = 'Filled from logs. Not saved yet.';
});

async function saveGrowthParams(stockingWeights, resetPredictions) {
    const initialStock = parseFloat(document.getElementById('gi_initialStock')?.value) || 0;

    const cycleStartVal = document.getElementById('gi_cycleStart')?.value;
    const cycleStart     = cycleStartVal ? new Date(cycleStartVal + 'T00:00:00') : null;
    // cycleEnd is derived, not user-set — no UI field for it. Recomputed from
    // cycleStart on every save so it can never go stale (overwrites any old
    // manually-entered value). Flutter reads this stored field directly.
    const cycleEnd = cycleStart ? new Date(cycleStart.getTime() + GROWOUT_DAYS * 24 * 60 * 60 * 1000) : null;

    const payload = { initialStock, cycleStart, cycleEnd, timestamp: serverTimestamp() };
    // Stocking fields follow the form: blanks are deleted from an existing doc, and a new cycle start drops the old RF prediction.
    for (const [field, g] of Object.entries(stockingWeights)) {
        if (g !== null) payload[field] = g;
        else if (growthDocRef) payload[field] = deleteField();
    }
    if (resetPredictions && growthDocRef) RF_PREDICTION_FIELDS.forEach(field => { payload[field] = deleteField(); });

    if (growthDocRef) {
        await setDoc(growthDocRef, payload, { merge: true });
    } else {
        const ref = await addDoc(collection(db, 'growth_indicators'), payload);
        growthDocRef = ref;
    }
}

// Growth form submit
const growthForm  = document.getElementById('growth-form');
const growthMsgEl = document.getElementById('growth-saved-msg');

if (growthForm) {
    growthForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newCycleStart = document.getElementById('gi_cycleStart')?.value;
        const cycleStartChanged = loadedCycleStart != null && newCycleStart !== loadedCycleStart;
        let stockingWeights;
        try {
            stockingWeights = readStockingWeights();
        } catch (err) {
            if (growthMsgEl) {
                growthMsgEl.textContent = err.message;
                growthMsgEl.style.color = '#dc2626';
                growthMsgEl.classList.add('show');
                setTimeout(() => { growthMsgEl.classList.remove('show'); growthMsgEl.style.color = ''; }, 4000);
            }
            return;
        }
        const ok = cycleStartChanged
            ? await confirmDialog('Change cycle start date?', 'Changing the cycle start date clears the current yield prediction and restarts the 3-month prediction timer. Update the stocking weight below if this is a new batch. Are you sure you want to continue?')
            : await confirmDialog('Save changes?', 'Are you sure you want to save these changes?');
        if (!ok) return;
        const btn = growthForm.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            await saveGrowthParams(stockingWeights, cycleStartChanged);
            // The saved date is now the baseline, so a second save doesn't count as another change.
            loadedCycleStart = newCycleStart;
            const savedStart = new Date(newCycleStart + 'T00:00:00');
            if (savedStart.getTime() !== hintCycleStartMs) loadStockingHint(savedStart);
            if (growthMsgEl) {
                growthMsgEl.textContent  = 'Growth parameters saved successfully.';
                growthMsgEl.style.color  = '';
                growthMsgEl.classList.add('show');
                setTimeout(() => growthMsgEl.classList.remove('show'), 3000);
            }
        } catch (err) {
            console.error('[settings] Growth params save failed:', err);
            if (growthMsgEl) {
                growthMsgEl.textContent = 'Failed to save. Check your connection and try again.';
                growthMsgEl.style.color = '#dc2626';
                growthMsgEl.classList.add('show');
                setTimeout(() => { growthMsgEl.classList.remove('show'); growthMsgEl.style.color = ''; }, 4000);
            }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '✓ Save parameters'; }
        }
    });
}

// ── Auth guard — load thresholds once user is confirmed ───────────────────────

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '../security/admin-tech-login.html';
        return;
    }
    loadThresholds();
    loadGrowthParams();
});

// ── Sidebar: mobile open/close ────────────────────────────────────────────────

(function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('topbarMenuBtn');
    if (sidebar && overlay && menuBtn) {
        menuBtn.addEventListener('click', () => {
            sidebar.classList.add('open');
            overlay.classList.add('show');
            overlay.setAttribute('aria-hidden', 'false');
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            overlay.setAttribute('aria-hidden', 'true');
        });
    }
})();

// ── Sidebar collapse/toggle, persistence and click-to-collapse ───────────────
initSidebar();
