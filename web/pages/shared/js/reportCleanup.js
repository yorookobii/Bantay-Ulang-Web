import { getRanges } from "./thresholds.js";
import { isSuspect } from "./plausibility.js";
import { THRESHOLD_KEY, STATUS_PARAMS, isBreached } from "./readingStatus.js";
import { isOverdue } from "./taskStatus.js";

// Pure clean-up and summary helpers for gatherReport(); no Firestore access.

const ALERT_GROUP_GAP_MS = 60 * 60 * 1000;
const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// Live alert docs use thresholds.js keys (phLevel -> ph); hardware and waterLevel have no reading field.
const FIELD_FOR_ALERT_PARAM = Object.fromEntries(Object.entries(THRESHOLD_KEY).map(([field, key]) => [key, field]));
const readingField = (param) => FIELD_FOR_ALERT_PARAM[param] || (STATUS_PARAMS.includes(param) ? param : null);

const higherSeverity = (a, b) => ((SEVERITY_RANK[b] || 0) > (SEVERITY_RANK[a] || 0) ? b : a);

// Merges alerts with the same type + parameter + status that follow each other within 60 minutes; newest group first.
export function groupAlerts(alerts) {
    const sorted = [...alerts].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    const latestByKey = new Map();
    const groups = [];
    for (const alert of sorted) {
        const key = `${alert.type}|${alert.parameter}|${alert.status}`;
        const prev = latestByKey.get(key);
        const joins = prev && alert.createdAtMs != null && prev.lastMs != null && alert.createdAtMs - prev.lastMs <= ALERT_GROUP_GAP_MS;
        const group = joins ? prev : { type: alert.type, parameter: alert.parameter, status: alert.status, firstMs: alert.createdAtMs, alertIds: [], members: [] };
        if (!joins) { groups.push(group); latestByKey.set(key, group); }
        group.lastMs = alert.createdAtMs;
        group.alertIds.push(alert.id);
        group.members.push(alert);
    }
    return groups
        .map(({ members, ...group }) => {
            const last = members[members.length - 1];
            const field = readingField(group.parameter);
            return {
                ...group,
                occurrences: members.length,
                severity: members.reduce((top, a) => higherSeverity(top, a.severity), ""),
                lastValue: last.currentValue,
                safeRange: last.safeRange,
                message: last.message,
                resolvedAtMs: last.resolvedAtMs,
                handled: members.every(a => a.handled),
                valueSuspect: field !== null && isSuspect(field, last.currentValue)
            };
        })
        .sort((a, b) => (b.lastMs ?? 0) - (a.lastMs ?? 0));
}

// Confirmed alive = initial stock minus every logged death (clamped at 0), or null without a stock count.
export function confirmedAlive(initialStock, totalDeaths) {
    const stock = Number(initialStock);
    return Number.isFinite(stock) && stock > 0 ? Math.max(0, Math.round(stock - totalDeaths)) : null;
}

// Giant freshwater prawn growth is heterogeneous (fast "bull" males vs. runts), so these are loose sanity caps whose numbers need adviser confirmation.
export const WEIGHT_CAP_BASE_G = 5;
export const WEIGHT_CAP_PER_WEEK_G = 5;
export const WEIGHT_MEDIAN_FACTOR = 3;
// Bounds relative to the cycle's stocking weight (sub-adult stock), replacing the fixed cap; needs adviser confirmation.
export const STOCK_LOW_FACTOR = 0.5;
export const STOCK_HIGH_FACTOR = 4;
export const STOCK_HIGH_PER_WEEK_G = 10;
// A week's weight is usable only with at least this many samples; mirror of predict_yield.py MIN_WEEK_SAMPLES.
export const MIN_WEEK_SAMPLES = 10;

export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Returns { week: reason } for weekly averages outside the week's bounds (stocking-relative when a stocking weight is set) or above 3x the median.
export function flagWeights(averages, stockingWeightG = null) {
    const values = averages.map(a => a.avgWeightG).filter(Number.isFinite);
    const med = values.length ? median(values) : null;
    const stock = Number(stockingWeightG) > 0 ? Number(stockingWeightG) : null;
    const flags = {};
    for (const { week, avgWeightG } of averages) {
        if (!Number.isFinite(avgWeightG)) continue;
        const reasons = [];
        if (stock !== null) {
            const low = Number((STOCK_LOW_FACTOR * stock).toFixed(1));
            const high = Number((STOCK_HIGH_FACTOR * stock + STOCK_HIGH_PER_WEEK_G * week).toFixed(1));
            if (avgWeightG < low) reasons.push(`Below the ${low} g minimum (${STOCK_LOW_FACTOR}x the ${stock} g stocking weight)`);
            if (avgWeightG > high) reasons.push(`Above the ${high} g limit for week ${week}`);
        } else {
            const cap = WEIGHT_CAP_BASE_G + WEIGHT_CAP_PER_WEEK_G * week;
            if (avgWeightG > cap) reasons.push(`Above the ${cap} g limit for week ${week}`);
        }
        if (med !== null && avgWeightG > WEIGHT_MEDIAN_FACTOR * med) reasons.push(`More than ${WEIGHT_MEDIAN_FACTOR}x the median weekly average (${Number(med.toFixed(1))} g)`);
        if (reasons.length) flags[week] = reasons.join("; ");
    }
    return flags;
}

// { week: { sum, count } } from weight samples; averaged per week by callers, never summed raw.
export function bucketWeightsByWeek(samples) {
    const byWeek = {};
    samples.forEach(({ weightG, week }) => {
        if (!byWeek[week]) byWeek[week] = { sum: 0, count: 0 };
        byWeek[week].sum   += weightG;
        byWeek[week].count += 1;
    });
    return byWeek;
}

// Shared usable-week rule (not flagged and >= MIN_WEEK_SAMPLES samples) for the feed panel and the pond trend; samples must have weightG > 0.
export function usableWeeks(samples, stockingWeightG = null) {
    const byWeek = bucketWeightsByWeek(samples);
    const flags = flagWeights(Object.entries(byWeek).map(([week, w]) => ({ week: Number(week), avgWeightG: w.sum / w.count })), stockingWeightG);
    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
    return { byWeek, flags, weeks, isUsable: (w) => !flags[w] && byWeek[w].count >= MIN_WEEK_SAMPLES };
}

// Per-parameter avg/min/max and % in range over sanitized rows (suspect values are already nulled).
function summarizeParameters(rows) {
    const ranges = getRanges();
    return STATUS_PARAMS.map(param => {
        const range = ranges[THRESHOLD_KEY[param]] || {};
        const values = rows.map(r => r[param]).filter(v => typeof v === "number" && Number.isFinite(v));
        const hasRange = range.min != null || range.max != null;
        const inRange = values.filter(v => !isBreached(param, v)).length;
        return {
            param,
            label: range.label || param,
            unit: range.unit || "",
            n: values.length,
            avg: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null,
            min: values.length ? Math.min(...values) : null,
            max: values.length ? Math.max(...values) : null,
            pctInRange: hasRange && values.length ? (inRange / values.length) * 100 : null,
            safeRange: hasRange ? range.safeRangeStr : ""
        };
    });
}

function summarizeWaterLevel(rows) {
    const known = rows.filter(r => typeof r.waterLevel === "boolean");
    return { n: known.length, pctSafe: known.length ? (known.filter(r => r.waterLevel).length / known.length) * 100 : null };
}

function summarizeTasks(tasks, now) {
    const counts = { total: tasks.length, pending: 0, "in-progress": 0, completed: 0, overdue: 0 };
    for (const task of tasks) {
        counts[task.status] += 1;
        if (isOverdue(task, now)) counts.overdue += 1;
    }
    return counts;
}

// Headline numbers for the PDF; a part is null when its section wasn't gathered or failed.
export function buildSummary(sections, now = Date.now()) {
    const rows = sections.waterQuality?.rows;
    return {
        parameters: rows ? summarizeParameters(rows) : null,
        waterLevel: rows ? summarizeWaterLevel(rows) : null,
        tasks: sections.tasks ? summarizeTasks(sections.tasks, now) : null
    };
}
