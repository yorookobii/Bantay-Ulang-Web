import { feedRecommendation, pickCurrentWeight } from "./feedRecommendation.js";
import { toDateValue } from "./logEntry.js";

// Recommended feed amount under the schedule form's Amount field; it only suggests, never saves.

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_DAYS = 14;
const BASIS = "Based on the feed-rate curve used by the yield model (Gupta et al.). Assumes all deaths are logged. "
    + "Adjust by observation: reduce if feed is left over or water quality is poor.";

const EMPTY = {
    "no-cycle": "No recommendation: no cycle start is set in Settings.",
    "no-stock": "No recommendation: initial stock isn't set for this cycle.",
    "no-alive": "No recommendation: no confirmed alive prawns (every stocked prawn is logged as dead).",
    "no-samples": "No recommendation yet: no weight samples this cycle. Log a few in the mobile app's Ulang log.",
    "all-flagged": "No recommendation: this cycle's weight entries look wrong (marked “Check entry” in reports). Check the latest samples.",
    "error": "Couldn't load the data for a recommendation. Close and reopen the form to try again."
};

const fmtNum = (n, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Grams to put in the field: whole grams, or one decimal below 10 g.
export const roundGrams = (g) => (g >= 10 ? Math.round(g) : Math.round(g * 10) / 10);

/** Cycle, alive count and weight samples, loaded once; heavy modules are imported only on first use. */
export async function loadInputs() {
    const [{ loadCycleInfo }, { loadMortalityRecords }, { loadWeightSamples }, { confirmedAlive }] = await Promise.all([
        import("./reportData.js"), import("./mortalityChart.js"), import("./avgWeightChart.js"), import("./reportCleanup.js")
    ]);
    const growth = await loadCycleInfo();
    const cycleStart = toDateValue(growth?.cycleStart);
    if (!cycleStart) return { reason: "no-cycle" };
    if (confirmedAlive(growth.initialStock, 0) === null) return { reason: "no-stock" };

    const [records, samples] = await Promise.all([loadMortalityRecords(cycleStart), loadWeightSamples(cycleStart)]);
    const alive = confirmedAlive(growth.initialStock, records.reduce((sum, r) => sum + r.deaths, 0));
    if (!alive) return { reason: "no-alive" };
    const weight = pickCurrentWeight(samples);
    if (weight.weightG === null) return { reason: weight.reason };
    return { alive, weight };
}

/** View model for one state: { reason } empty states, or the recommendation with its math and notes. */
export function describe(inputs, enabledCount, now = Date.now()) {
    if (inputs.reason) return { kind: "empty", text: EMPTY[inputs.reason] };
    const { alive, weight } = inputs;
    const feedingsPerDay = enabledCount + 1;
    const rec = feedRecommendation({ alive, avgWeightG: weight.weightG, feedingsPerDay });
    const grams = roundGrams(rec.gramsPerFeeding);
    const ageDays = Math.floor((now - weight.latestSampleMs) / DAY_MS);
    const skipped = weight.skippedWeeks.length
        ? ` (skipped week ${weight.skippedWeeks.join(", ")}: entries look wrong)` : "";
    return {
        kind: "ok",
        grams,
        title: `Recommended: about ${fmtNum(grams, grams < 10 ? 1 : 0)} g per feeding`,
        math: `${fmtNum(alive)} alive × ${fmtNum(weight.weightG, 1)} g × ${fmtNum(rec.ratePct, 1)}% per day `
            + `÷ ${plural(feedingsPerDay, "feeding")} a day (${enabledCount} enabled + this one)`,
        sample: `Median weight of ${plural(weight.sampleCount, "sample")}, week ${weight.week}, sampled ${fmtDate(weight.latestSampleMs)}${skipped}.`,
        capNote: weight.weightG >= 25 ? "Rate held at 5% from 25 g (end of the curve)." : null,
        stale: ageDays > STALE_DAYS
            ? `Latest weight sample is ${ageDays} days old. Weigh a few prawns for a better estimate.` : null,
        basis: BASIS
    };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Wires the panel; call load() when the form first opens and setEnabledCount() on every schedule snapshot. */
export function initFeedRecommendation({ container, amountInput }) {
    let inputs = null;
    let pending = null;
    let enabledCount = 0;

    function render() {
        if (!inputs) {
            container.innerHTML = `<p class="feed-rec-head">Recommended amount</p>
                <p class="feed-rec-body">${pending ? "Working out a recommended amount…" : ""}</p>`;
            return;
        }
        const view = describe(inputs, enabledCount);
        if (view.kind === "empty") {
            container.innerHTML = `<p class="feed-rec-head">Recommended amount</p><p class="feed-rec-body feed-rec-empty">${esc(view.text)}</p>`;
            return;
        }
        container.innerHTML = `
            <p class="feed-rec-head">${esc(view.title)}</p>
            <p class="feed-rec-math">${esc(view.math)}</p>
            <p class="feed-rec-meta">${esc(view.sample)}</p>
            ${view.capNote ? `<p class="feed-rec-meta">${esc(view.capNote)}</p>` : ""}
            ${view.stale ? `<p class="feed-rec-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${esc(view.stale)}</p>` : ""}
            <p class="feed-rec-fine">${esc(view.basis)}</p>
            <div class="feed-rec-actions">
                <button type="button" class="fr-btn fr-btn-secondary feed-rec-use" data-grams="${view.grams}">Use recommended</button>
                <span class="feed-rec-status" role="status" aria-live="polite"></span>
            </div>`;
    }

    // Fills the field only; saving stays with the form's Save Schedule button.
    container.addEventListener("click", (e) => {
        const btn = e.target.closest(".feed-rec-use");
        if (!btn) return;
        amountInput.value = btn.dataset.grams;
        amountInput.classList.remove("invalid");
        amountInput.dispatchEvent(new Event("input", { bubbles: true }));
        container.querySelector(".feed-rec-status").textContent = `Amount set to ${btn.dataset.grams} g. Not saved yet.`;
    });

    return {
        load() {
            if (inputs || pending) return pending;
            pending = loadInputs()
                .catch((err) => { console.warn("feedRecommendation: could not load inputs.", err); return { reason: "error" }; })
                .then((result) => {
                    pending = null;
                    inputs = result;
                    render();
                    if (result.reason === "error") inputs = null; // next open retries
                });
            render();
            return pending;
        },
        setEnabledCount(n) {
            enabledCount = n;
            if (inputs) render();
        }
    };
}
