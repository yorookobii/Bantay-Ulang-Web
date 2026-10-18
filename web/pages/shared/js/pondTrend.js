// This pond's own growth trend from its weigh-ins; no Firestore calls, no literature constants.
import { median, usableWeeks } from "./reportCleanup.js";
import { HARVEST_WEEK } from "./survivalTrend.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PROJECT_WEEKS = 4;
// One weigh-in vs the stocking weight is within sampling noise (stock 26-46 g, n=10 each), so a trend needs two usable weeks.
export const MIN_TREND_WEEKS = 2;

/**
 * Fits W^(1/3) = cbrt(stocking) + k * days by least squares with the intercept fixed at the stocking weight
 * (k = sum t*(cbrt(W) - cbrt(S)) / sum t^2), over usable weeks (same rule as the feed panel).
 * Day t = cycle start to the median sample time of the week (observedAt ?? createdAt), else the week midpoint.
 * Projects PROJECT_WEEKS weeks (7 days each, like the RF projection) from the latest usable median, clipped at HARVEST_WEEK.
 * Returns { k, weeks, latestWeek, points: [{ week, weightG }] } or null (no stocking weight, too few usable weeks, k <= 0).
 */
export function pondTrend(samples, cycleStartMs, stockingWeightG) {
    const stock = Number(stockingWeightG);
    if (!(stock > 0)) return null;
    const positive = samples.filter((s) => s.weightG > 0);
    if (!positive.length) return null;

    const { weeks, isUsable } = usableWeeks(positive, stock);
    const fitWeeks = weeks.filter(isUsable).sort((a, b) => a - b);
    if (fitWeeks.length < MIN_TREND_WEEKS) return null;

    const c0 = Math.cbrt(stock);
    let num = 0;
    let den = 0;
    const medians = {};
    for (const week of fitWeeks) {
        const inWeek = positive.filter((s) => s.week === week);
        medians[week] = median(inWeek.map((s) => s.weightG));
        const times = inWeek.map((s) => s.observedAtMs ?? s.createdAtMs).filter(Number.isFinite);
        const t = times.length ? (median(times) - cycleStartMs) / DAY_MS : (week - 1) * 7 + 3.5;
        num += t * (Math.cbrt(medians[week]) - c0);
        den += t * t;
    }
    const k = den > 0 ? num / den : 0;
    if (!(k > 0)) return null;

    const latestWeek = fitWeeks[fitWeeks.length - 1];
    const start = Math.cbrt(medians[latestWeek]);
    const points = [{ week: latestWeek, weightG: medians[latestWeek] }];
    for (let j = 1; j <= PROJECT_WEEKS && latestWeek + j <= HARVEST_WEEK; j++) {
        points.push({ week: latestWeek + j, weightG: (start + 7 * k * j) ** 3 });
    }
    return { k, weeks: fitWeeks, latestWeek, points };
}
