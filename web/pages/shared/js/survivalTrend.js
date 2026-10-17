// 150-day grow-out horizon, same as predict_yield.py HARVEST_WEEK.
export const HARVEST_WEEK = 21;
// Completed weeks needed before a trend is drawn, same as predict_yield.py SURVIVAL_TREND_MIN_WEEKS.
export const TREND_MIN_WEEKS = 3;

// Survival trend to HARVEST_WEEK at the compounded average weekly death rate of completed weeks (no record = 0 deaths); mirror of predict_yield.py project_survival.
export function projectSurvival(deathsByWeek, initialStock, currentWeek) {
    const k = Math.min(currentWeek - 1, HARVEST_WEEK);
    if (k < TREND_MIN_WEEKS) return null;
    let deaths = 0;
    for (let w = 1; w <= k; w++) deaths += deathsByWeek[w] || 0;
    const survivalK = Math.max(0, ((initialStock - deaths) / initialStock) * 100);
    const weeklyRate = 1 - Math.pow(survivalK / 100, 1 / k);
    const points = [];
    for (let w = k; w <= HARVEST_WEEK; w++) points.push({ week: w, pct: survivalK * Math.pow(1 - weeklyRate, w - k) });
    return { completedWeeks: k, weeklyRate, points };
}
