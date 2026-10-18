import { median, usableWeeks } from "./reportCleanup.js";

// Pure feed-amount helpers for the Automation schedule form; no Firestore access.

/**
 * Feed rate (% of body weight per day) by average weight; mirror of predict_yield.py optimal_feed_rate, SEAFDEC/AQD 2016.
 * Below 5 g 10%, 5 to under 15 g 7%, 15 to 25 g 5%, above 25 g 3%.
 */
export function optimalFeedRatePct(weightG) {
    if (weightG < 5) return 10.0;
    if (weightG < 15) return 7.0;
    if (weightG <= 25) return 5.0;
    return 3.0;
}

/** Daily and per-feeding grams for the stock, or null when an input can't support a number. */
export function feedRecommendation({ alive, avgWeightG, feedingsPerDay }) {
    if (!(alive > 0) || !(avgWeightG > 0) || !(feedingsPerDay >= 1)) return null;
    const ratePct = optimalFeedRatePct(avgWeightG);
    const biomassG = alive * avgWeightG;
    const gramsPerDay = biomassG * ratePct / 100;
    return { gramsPerDay, gramsPerFeeding: gramsPerDay / feedingsPerDay, ratePct, biomassG };
}

/**
 * Current average weight: median of the latest week that isn't flagged ("Check entry" in the report)
 * and has at least MIN_WEEK_SAMPLES samples, stepping back past weeks that fail either test (like predict_yield.py).
 * stockingWeightG sets the flag bounds the same way the report does.
 * Returns { weightG, week, sampleCount, latestSampleMs, skippedFlagged, skippedFew } or { weightG: null, reason, latest? }.
 */
export function pickCurrentWeight(samples, stockingWeightG = null) {
    const usable = samples.filter((s) => s.weightG > 0);
    if (!usable.length) return { weightG: null, reason: "no-samples" };

    const { byWeek, flags, weeks, isUsable } = usableWeeks(usable, stockingWeightG);
    const week = weeks.find(isUsable);
    if (week === undefined) {
        // Every week flagged is a data problem to show; otherwise too few samples, which falls back to the stocking weight.
        if (weeks.every((w) => flags[w])) return { weightG: null, reason: "all-flagged" };
        return { weightG: null, reason: "too-few", latest: { week: weeks[0], n: byWeek[weeks[0]].count } };
    }

    const inWeek = usable.filter((s) => s.week === week);
    const later = weeks.filter((w) => w > week);
    return {
        weightG: median(inWeek.map((s) => s.weightG)),
        week,
        sampleCount: inWeek.length,
        latestSampleMs: Math.max(...inWeek.map((s) => s.observedAtMs ?? s.createdAtMs)),
        skippedFlagged: later.filter((w) => flags[w]),
        skippedFew: later.filter((w) => !flags[w]).map((w) => ({ week: w, n: byWeek[w].count }))
    };
}
