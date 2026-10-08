import { flagWeights, median } from "./reportCleanup.js";
import { bucketWeightsByWeek } from "./avgWeightChart.js";

// Pure feed-amount helpers for the Automation schedule form; no Firestore access.

/**
 * Optimal feed rate (% of body weight per day) by average weight.
 * Same curve as the yield model: ml-analytics/bantay_ulang_ml.ipynb (Section 2.5,
 * optimal_feed_rate) and ml-analytics/predict_yield.py optimal_feed_rate.
 * Gupta et al.: 10% (small) to 5% (large), linear between 2 g and 25 g.
 */
export function optimalFeedRatePct(weightG) {
    if (weightG <= 2) return 10.0;
    if (weightG >= 25) return 5.0;
    return 10.0 - (weightG - 2) * (5.0 / 23.0);
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
 * Current average weight: median of the latest week whose average isn't flagged
 * ("Check entry" in the report), stepping back past flagged weeks.
 * Returns { weightG, week, sampleCount, latestSampleMs, skippedWeeks } or { weightG: null, reason }.
 */
export function pickCurrentWeight(samples) {
    const usable = samples.filter((s) => s.weightG > 0);
    if (!usable.length) return { weightG: null, reason: "no-samples" };

    const byWeek = bucketWeightsByWeek(usable);
    const flags = flagWeights(Object.entries(byWeek).map(([week, w]) => ({ week: Number(week), avgWeightG: w.sum / w.count })));
    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
    const week = weeks.find((w) => !flags[w]);
    if (week === undefined) return { weightG: null, reason: "all-flagged" };

    const inWeek = usable.filter((s) => s.week === week);
    return {
        weightG: median(inWeek.map((s) => s.weightG)),
        week,
        sampleCount: inWeek.length,
        latestSampleMs: Math.max(...inWeek.map((s) => s.observedAtMs ?? s.createdAtMs)),
        skippedWeeks: weeks.filter((w) => w > week)
    };
}
