import { getReadingsInRange, catchUpCache } from "./readingsService.js";
import { getRanges } from "./thresholds.js";

/*
 * envTrendsChart.js — shared Environmental Trends chart, used by both the
 * dashboard widget (dashboard.js) and the dedicated environmental-trends.html
 * page. Reads HistoryLogs via readingsService.js, bucket-averages into
 * hourly/daily/weekly points so the x-axis stays clean at any range, and
 * renders a single Chart.js line chart for whichever parameter is selected.
 */

export const ENV_PARAM_CONFIG = {
    ph:              { label: "pH",                       yMin: 6.5, yMax: 8.5, color: "#2563eb" },
    dissolvedOxygen: { label: "Dissolved Oxygen (mg/L)",   yMin: 5,   yMax: 9,   color: "#0891b2" },
    waterTemp:       { label: "Temperature (°C)",          yMin: 20,  yMax: 32,  color: "#dc2626" },
    salinity:        { label: "Salinity (ppt)",            yMin: 0,   yMax: 18,  color: "#7c3aed" },
    turbidity:       { label: "Turbidity (NTU)",           yMin: 0,   yMax: 25,  color: "#b45309" },
    tds:             { label: "TDS (ppm)",                 color: "#0d9488" }
};

export const ENV_RANGE_CONFIG = {
    "24h": { ms: 24 * 60 * 60 * 1000,      label: "Last 24 Hours" },
    "7d":  { ms: 7  * 24 * 60 * 60 * 1000, label: "Last 7 Days" },
    "30d": { ms: 30 * 24 * 60 * 60 * 1000, label: "Last 30 Days" }
};

function computeRange(values, fallbackMin, fallbackMax) {
    const numericValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (!numericValues.length) return { min: fallbackMin, max: fallbackMax };

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    if (min === max) {
        const pad = Math.max(Math.abs(min) * 0.15, 0.5);
        return { min: min - pad, max: max + pad };
    }

    const pad = Math.max((max - min) * 0.15, 0.5);
    return { min: min - pad, max: max + pad };
}

function envFallbackRange(paramKey, config) {
    if (paramKey !== "tds") return { min: config.yMin, max: config.yMax };

    const tdsRange = getRanges().tds;
    const hasBoth = tdsRange && tdsRange.min != null && tdsRange.max != null;
    return hasBoth ? { min: tdsRange.min, max: tdsRange.max } : { min: undefined, max: undefined };
}

// ── Bucketing ────────────────────────────────────────────────────────────────

function startOfHour(date) { const d = new Date(date); d.setMinutes(0, 0, 0); return d; }
function startOfDay(date)  { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek(date) {
    const d = startOfDay(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // roll back to Monday
    return d;
}

const BUCKET_MS = { "24h": 60 * 60 * 1000, "7d": 24 * 60 * 60 * 1000, "30d": 7 * 24 * 60 * 60 * 1000 };
const BUCKET_START = { "24h": startOfHour, "7d": startOfDay, "30d": startOfWeek };
const BUCKET_LABEL = {
    "24h": (d) => d.toLocaleTimeString("en-PH", { hour: "numeric" }),
    "7d":  (d) => d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }),
    "30d": (d) => {
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        return `${d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}–${end.getDate()}`;
    }
};

/**
 * bucketReadings(readings, paramKey, rangeKey, sinceMs, untilMs)
 *
 * Averages readings[paramKey] into hourly (24h) / daily (7d) / weekly (30d)
 * buckets. Walks every expected bucket slot in [sinceMs, untilMs], not just
 * the ones with data, so a bucket with no readings comes back as an explicit
 * { value: null } gap rather than being silently skipped.
 */
export function bucketReadings(readings, paramKey, rangeKey, sinceMs, untilMs) {
    const bucketStart = BUCKET_START[rangeKey];
    const label = BUCKET_LABEL[rangeKey];
    const stepMs = BUCKET_MS[rangeKey];

    const sums = new Map();
    readings.forEach((reading) => {
        const value = reading[paramKey];
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const key = bucketStart(new Date(reading.measuredAtMs)).getTime();
        const entry = sums.get(key) || { sum: 0, count: 0 };
        entry.sum += value;
        entry.count += 1;
        sums.set(key, entry);
    });

    const points = [];
    let cursor = bucketStart(new Date(sinceMs)).getTime();
    const end = bucketStart(new Date(untilMs)).getTime();
    while (cursor <= end) {
        const entry = sums.get(cursor);
        points.push({
            label: label(new Date(cursor)),
            value: entry ? entry.sum / entry.count : null
        });
        cursor += stepMs;
    }
    return points;
}

// ── Fetch (cold-cache-safe) ──────────────────────────────────────────────────

async function getReadingsInRangeCaughtUp(cycleStartMs, sinceMs, untilMs) {
    await catchUpCache(cycleStartMs);
    return getReadingsInRange(cycleStartMs, sinceMs, untilMs);
}

async function fetchEnvTrends(paramKey, rangeKey, cycleStartMs) {
    const now = Date.now();
    const cutoff = now - ENV_RANGE_CONFIG[rangeKey].ms;
    const readings = await getReadingsInRangeCaughtUp(cycleStartMs, cutoff, now);
    return bucketReadings(readings, paramKey, rangeKey, cutoff, now);
}

// ── Chart ────────────────────────────────────────────────────────────────────

/**
 * initEnvTrendsChart(canvas)
 *
 * Builds and returns the Chart.js line chart instance. Called once per page
 * (the dashboard widget's small canvas and the dedicated page's larger one
 * use the exact same config — sizing is CSS, not a chart option).
 */
export function initEnvTrendsChart(canvas) {
    return new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "",
                data: [],
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                fill: true,
                tension: 0.4,
                spanGaps: false // an empty bucket is a null point — show it as a gap, not a bridge
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: false, grid: { color: "#f3f4f6" } },
                x: { grid: { display: false } }
            }
        }
    });
}

/**
 * refreshEnvTrendsChart(chart, paramKey, rangeKey, cycleStartMs)
 *
 * Fetches (with cold-cache catch-up), buckets, and redraws the given chart
 * for the selected parameter/range. Safe to call repeatedly (e.g. on every
 * dropdown change) — after the first call, the underlying cache is warm and
 * this resolves quickly.
 */
export async function refreshEnvTrendsChart(chart, paramKey, rangeKey, cycleStartMs) {
    if (!chart) return;

    const config = ENV_PARAM_CONFIG[paramKey] || ENV_PARAM_CONFIG.ph;

    try {
        const points = await fetchEnvTrends(paramKey, rangeKey, cycleStartMs);
        const labels = points.map((point) => point.label);
        const values = points.map((point) => point.value);
        const fallback = envFallbackRange(paramKey, config);
        const range = computeRange(values, fallback.min, fallback.max);

        chart.data.labels = labels;
        chart.data.datasets[0].label = config.label;
        chart.data.datasets[0].data = values;
        chart.data.datasets[0].borderColor = config.color;
        chart.data.datasets[0].backgroundColor = config.color + "1a";
        chart.options.scales.y.min = range.min;
        chart.options.scales.y.max = range.max;
        chart.update();
    } catch (err) {
        console.warn("envTrendsChart: unable to load environmental trends:", err);
    }
}
