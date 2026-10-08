import { auth, db } from "./firebase.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as cacheStore from "./cacheStore.js";
import { catchUpCache } from "./readingsService.js";
import { DEFAULT_FETCH_LIMIT, fetchReadingsInRange } from "./historyLogsReader.js";
import { loadThresholds } from "./thresholds.js";
import { sanitizeReading } from "./plausibility.js";
import { computeRowStatus, STATUS_PARAMS } from "./readingStatus.js";
import { calcYield } from "./yieldPrediction.js";
import { yieldWaterNote } from "./yieldLabels.js";
import { loadMortalityRecords, bucketDeathsByWeek } from "./mortalityChart.js";
import { loadWeightsByWeek } from "./avgWeightChart.js";
import { normalizeStatus } from "./taskStatus.js";
import { normalizeLogData, getTextField, toDateValue, LOG_ACTOR_KEYS } from "./logEntry.js";
import { groupAlerts, flagWeights, buildSummary, median } from "./reportCleanup.js";

// Report data layer: gathers every section from existing read paths, no UI.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// Densest HistoryLogs cadence seen (the 2-minute synthetic backfill), so read estimates err high.
const READ_ESTIMATE_INTERVAL_MS = 2 * 60 * 1000;
// Live firmware cadence, used for coverage only when a range has too few readings to measure it.
const DEFAULT_CADENCE_MS = 5 * 60 * 1000;
const LOW_COVERAGE_PCT = 90;
const ALERT_LIMIT = 500;
const PAGE_SIZE = 200;                        // tasks/logs page size
const MAX_PAGES = 20;                         // tasks/logs cap: 4,000 docs each

const REPORT_ACTOR_KEYS = LOG_ACTOR_KEYS.filter(key => key !== "createdByEmail");
const EMAIL_RE = /\S+@\S+\.\S+/;

export const SECTIONS =["waterQuality", "alerts", "mortalityGrowth", "yield", "tasks", "logs"];
export const MAX_CUSTOM_RANGE_DAYS = 31;
export const READ_BUDGET = 20000;
// Longest range whose readings fit the budget with nothing cached (27 days at 720/day).
export const MAX_UNCACHED_DAYS = Math.floor(READ_BUDGET / (DAY_MS / READ_ESTIMATE_INTERVAL_MS));
// A cache whose newest reading is this close to the range end counts as covering it.
const CACHE_TOLERANCE_MS = 10 * 60 * 1000;
export const MODEL_DISCLAIMER =
    "Yield and revenue are estimates from a Random Forest model trained on synthetic data " +
    "(R² 0.79 on a held-out test split; 5-fold CV mean 0.73). Revenue uses BFAR 2025 prices " +
    "of ₱150–450/kg. Treat them as estimates, not guarantees.";

// ─── Range helpers (for the modal) ──────────────────────────────────────────

export function rangeForPreset(preset, cycleStartMs, now = Date.now()) {
    if (preset === "7d")  return { sinceMs: now - 7 * DAY_MS, untilMs: now };
    if (preset === "30d") return { sinceMs: now - 30 * DAY_MS, untilMs: now };
    if (preset === "cycle" && cycleStartMs != null) return { sinceMs: cycleStartMs, untilMs: now };
    return null;
}

// Returns an error message, or null when the custom range is usable.
export function validateCustomRange(sinceMs, untilMs) {
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) return "Choose both a start and an end date.";
    if (sinceMs > untilMs) return "The start date must be on or before the end date.";
    if (untilMs - sinceMs > MAX_CUSTOM_RANGE_DAYS * DAY_MS) return `Custom ranges are limited to ${MAX_CUSTOM_RANGE_DAYS} days.`;
    return null;
}

/**
 * estimateNewReads(cycleStartMs, sinceMs, untilMs, now)
 * Plans how the report gets readings for the range and how many HistoryLogs
 * docs that costs (an upper bound at the 2-minute cadence):
 *   "cache"        cache already covers the range: 0 reads.
 *   "catch-up"     usable cache is behind, and topping it up is cheaper than the range.
 *   "direct-range" cold/invalidated/unavailable cache, or topping up costs more:
 *                  ranged query that never writes to the cache.
 * The window is clamped to the current cycle and to now.
 */
export async function estimateNewReads(cycleStartMs, sinceMs, untilMs, now = Date.now()) {
    const [dbHandle, lastSync, cachedCycle] = await Promise.all([
        cacheStore.openDB(), cacheStore.getLastSync(), cacheStore.getCachedCycleStart()
    ]);
    const windowSinceMs = Math.max(sinceMs, cycleStartMs ?? sinceMs);
    const windowUntilMs = Math.min(untilMs, now);
    const rangeReads = Math.max(0, Math.ceil((windowUntilMs - windowSinceMs) / READ_ESTIMATE_INTERVAL_MS));

    const cacheAvailable = dbHandle != null;
    // Mirrors readingsService.reconcileCycleStart: a different recorded cycle clears the cache.
    const invalidated = cycleStartMs != null && cachedCycle != null && cachedCycle !== cycleStartMs;
    const usable = cacheAvailable && !invalidated && lastSync != null;
    const plan = (source, newReads) => ({ source, newReads, cacheAvailable, windowSinceMs, windowUntilMs });

    // Cold syncs start at cycleStart, so a usable cache holds everything from the window start to lastSync.
    if (rangeReads === 0 || (usable && lastSync >= windowUntilMs - CACHE_TOLERANCE_MS)) return plan("cache", 0);
    const catchUpReads = usable ? Math.ceil((now - lastSync) / READ_ESTIMATE_INTERVAL_MS) : Infinity;
    return catchUpReads <= rangeReads ? plan("catch-up", catchUpReads) : plan("direct-range", rangeReads);
}

// Decides whether a report may run given its read estimate; applies to every preset and custom range.
export function checkReadBudget(estimate) {
    if (estimate.newReads >= READ_BUDGET) {
        return {
            allowed: false,
            message: `This report needs about ${estimate.newReads.toLocaleString("en-PH")} sensor readings that aren't saved in this browser yet, ` +
                `above the ${READ_BUDGET.toLocaleString("en-PH")}-read limit per report (Firestore's free tier allows 50,000 reads a day). ` +
                `Choose a range of ${MAX_UNCACHED_DAYS} days or fewer.`
        };
    }
    return { allowed: true, message: "" };
}

// ─── Shared loaders ─────────────────────────────────────────────────────────

// Latest growth_indicators doc (same query every page uses), or null.
export async function loadCycleInfo() {
    const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
    return snap.empty ? null : snap.docs[0].data();
}

// Name + role only; the email is deliberately left out.
async function loadGeneratedBy() {
    const user = auth.currentUser;
    if (!user) return { name: "Unknown user", role: "" };
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? snap.data() : {};
        return { name: data.fullName || user.displayName || "Unknown user", role: data.role || "" };
    } catch (err) {
        console.warn("[reportData] Could not load user profile:", err);
        return { name: user.displayName || "Unknown user", role: "" };
    }
}

// Pages a collection newest-first by createdAt (the logs.js / history.js query shape) until docs fall before sinceMs.
async function loadByCreatedAtDesc(collName, sinceMs) {
    const docs = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
        const clauses = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];
        if (cursor) clauses.push(startAfter(cursor));
        const snap = await getDocs(query(collection(db, collName), ...clauses));
        docs.push(...snap.docs);
        if (snap.size < PAGE_SIZE) return { docs, truncated: false };
        cursor = snap.docs[snap.size - 1];
        const oldest = toDateValue(cursor.data().createdAt);
        if (oldest && oldest.getTime() < sinceMs) return { docs, truncated: false };
    }
    return { docs, truncated: true };
}

const inRange = (ms, sinceMs, untilMs) => ms != null && ms >= sinceMs && ms <= untilMs;
const toMs = (value) => toDateValue(value)?.getTime() ?? null;

// ─── Sections ───────────────────────────────────────────────────────────────

function emptyStats() {
    return { min: null, max: null, sum: 0, n: 0 };
}

function addStat(stat, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    stat.min = stat.min === null ? value : Math.min(stat.min, value);
    stat.max = stat.max === null ? value : Math.max(stat.max, value);
    stat.sum += value;
    stat.n += 1;
}

// Groups sanitized rows by local calendar day with per-parameter min/avg/max.
function buildDaily(rows) {
    const byDay = new Map();
    for (const row of rows) {
        const date = new Date(row.measuredAtMs).toLocaleDateString("en-CA");
        if (!byDay.has(date)) {
            const params = {};
            STATUS_PARAMS.forEach(p => { params[p] = emptyStats(); });
            byDay.set(date, { date, readings: 0, suspect: 0, outOfRange: 0, waterLevelUnsafe: 0, params });
        }
        const day = byDay.get(date);
        day.readings += 1;
        if (row.suspectFields.length) day.suspect += 1;
        if (row.status === "out-of-range") day.outOfRange += 1;
        if (row.waterLevel === false) day.waterLevelUnsafe += 1;
        STATUS_PARAMS.forEach(p => addStat(day.params[p], row[p]));
    }
    return [...byDay.values()].map(day => {
        const params = {};
        for (const [p, s] of Object.entries(day.params)) {
            params[p] = { min: s.min, avg: s.n ? s.sum / s.n : null, max: s.max, n: s.n };
        }
        return { ...day, params };
    });
}

const fmtDateTime = (ms) => new Date(ms).toLocaleString("en-PH");

// Reading interval for coverage: median firmware summary window, else median gap between readings, else 5 min.
function readingCadence(rows) {
    const windows = rows.map(r => r.summaryWindowSec).filter(Number.isFinite);
    if (windows.length) return { ms: median(windows) * 1000, source: "summary-window" };
    const gaps = [];
    for (let i = 1; i < rows.length; i++) {
        const gap = rows[i].measuredAtMs - rows[i - 1].measuredAtMs;
        if (gap > 0) gaps.push(gap);
    }
    return gaps.length ? { ms: median(gaps), source: "observed" } : { ms: DEFAULT_CADENCE_MS, source: "default" };
}

async function gatherWaterQuality({ sinceMs, untilMs, cycleStartMs, now, onProgress, meta, warnings }) {
    const plan = await estimateNewReads(cycleStartMs, sinceMs, untilMs, now);
    const { windowSinceMs, windowUntilMs } = plan;
    let docsRead = 0;
    const onPage = (n) => { docsRead += n; if (onProgress) onProgress({ stage: "readings", fetched: docsRead, expected: plan.newReads }); };
    const fromCache = () => cacheStore.getReadings(windowSinceMs, windowUntilMs);

    if (cycleStartMs != null && sinceMs < cycleStartMs) {
        warnings.push({ code: "pre-cycle", message: `Sensor readings before the cycle start (${fmtDateTime(cycleStartMs)}) are not included.` });
    }

    let raw = [];
    let state = plan.source;
    let error = null;
    if (plan.source === "cache") {
        raw = await fromCache();
    } else if (plan.source === "catch-up") {
        const caughtUp = await catchUpCache(cycleStartMs, {
            maxIterations: Math.ceil(plan.newReads / DEFAULT_FETCH_LIMIT) + 2,
            timeBudgetMs: 120000,
            onPage
        });
        raw = await fromCache();
        if (!caughtUp) {
            state = "partial";
            const lastSync = await cacheStore.getLastSync();
            warnings.push({ code: "sync-incomplete", message: "Couldn't finish updating this browser's saved readings; readings after " + (lastSync ? fmtDateTime(lastSync) : "the cycle start") + " may be missing." });
        }
    } else {
        try {
            const result = await fetchReadingsInRange(windowSinceMs, windowUntilMs, { maxDocs: READ_BUDGET, onPage });
            raw = result.readings;
            if (result.truncated) {
                state = "partial";
                warnings.push({ code: "readings-truncated", message: `Stopped at ${READ_BUDGET.toLocaleString("en-PH")} readings; later readings in the range are missing.` });
            }
        } catch (err) {
            if (!plan.cacheAvailable) throw err;
            error = err.code || err.message || String(err);
            raw = await fromCache();
            state = "cache-only";
            warnings.push({ code: "sync-failed", message: `Couldn't reach the server (${error}); readings come from this browser's saved copy only, which may be incomplete.` });
        }
    }
    meta.sync = { state, docsRead, lastSyncMs: await cacheStore.getLastSync(), error };

    // Synthetic test readings never count toward any water-quality figure; they are only counted.
    const syntheticExcluded = raw.filter(reading => reading.isSynthetic).length;
    if (syntheticExcluded) {
        warnings.push({ code: "synthetic-excluded", message: `${syntheticExcluded.toLocaleString("en-PH")} synthetic test readings excluded from every water-quality figure.` });
    }

    // Readings with no sensor values at all are skipped from the rows and only counted.
    const allRows = raw.filter(reading => !reading.isSynthetic).map(reading => {
        const { reading: clean, suspect } = sanitizeReading(reading);
        return { ...clean, status: computeRowStatus(reading), suspectFields: suspect };
    });
    const rows = allRows.filter(r => r.status !== "no-data");

    // Expected readings only count time inside the cycle and not in the future.
    const cadence = readingCadence(allRows);
    const expected = windowUntilMs > windowSinceMs ? Math.floor((windowUntilMs - windowSinceMs) / cadence.ms) : 0;
    const pct = expected ? Math.min(100, (rows.length / expected) * 100) : null;
    meta.coverage = {
        expected,
        actual: rows.length,
        pct,
        suspect: rows.filter(r => r.suspectFields.length).length,
        noDataSkipped: allRows.length - rows.length,
        syntheticExcluded,
        cadenceMs: cadence.ms,
        cadenceSource: cadence.source
    };
    if (pct !== null && pct < LOW_COVERAGE_PCT) {
        warnings.push({ code: "partial-coverage", message: `Only ${pct.toFixed(1)}% of expected sensor readings exist in this range (${rows.length.toLocaleString("en-PH")} of ${expected.toLocaleString("en-PH")}); gaps mean the sensor was offline or not logging.` });
    }

    return { rows, daily: buildDaily(rows) };
}

function normalizeAlert(snap) {
    const d = snap.data();
    return {
        id: snap.id,
        status: d.status || "",
        handled: d.handledAt != null,
        type: d.type || "",
        parameter: d.parameter || "",
        severity: d.severity || "",
        currentValue: d.currentValue ?? null,
        safeRange: d.safeRange ?? "",
        message: d.message || "",
        createdAtMs: toMs(d.createdAt),
        resolvedAtMs: toMs(d.resolvedAt),
        handledAtMs: toMs(d.handledAt)
    };
}

// Active alerts read directly (fetchActiveAlerts would run reevaluateActiveAlerts, which writes); resolved ones by resolvedAt.
async function gatherAlerts({ sinceMs, untilMs, meta, warnings }) {
    const [activeSnap, resolvedSnap] = await Promise.all([
        getDocs(query(collection(db, "alerts"), where("status", "==", "active"))),
        getDocs(query(
            collection(db, "alerts"),
            where("resolvedAt", ">=", Timestamp.fromMillis(sinceMs)),
            where("resolvedAt", "<=", Timestamp.fromMillis(untilMs)),
            orderBy("resolvedAt", "desc"),
            limit(ALERT_LIMIT)
        ))
    ]);
    if (resolvedSnap.size === ALERT_LIMIT) {
        warnings.push({ code: "alerts-truncated", message: `Only the ${ALERT_LIMIT} most recently resolved alerts are included.` });
    }
    // Active alerts opened after the range ended don't belong to it.
    const activeSnaps = activeSnap.docs.filter(snap => { const ms = toMs(snap.data().createdAt); return ms == null || ms <= untilMs; });
    // Duplicates marked by hand (excludeFromReports === true) are dropped and only counted.
    const isExcluded = snap => snap.data().excludeFromReports === true;
    meta.excluded = { duplicateAlerts: [...activeSnaps, ...resolvedSnap.docs].filter(isExcluded).length };
    const keep = snaps => snaps.filter(snap => !isExcluded(snap)).map(normalizeAlert);
    const active = keep(activeSnaps);
    const resolved = keep(resolvedSnap.docs);
    const byNewest = (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    return { groups: groupAlerts([...active, ...resolved]), active: active.sort(byNewest), resolved };
}

async function gatherMortalityGrowth({ sinceMs, untilMs, growth, now, warnings }) {
    const cycleStart = toDateValue(growth?.cycleStart);
    if (!cycleStart) {
        warnings.push({ code: "no-cycle", message: "No cycle start date is set in Settings, so mortality and growth can't be reported." });
        return null;
    }
    const [records, weightsByWeek] = await Promise.all([loadMortalityRecords(cycleStart), loadWeightsByWeek(cycleStart)]);
    const { byWeek: deathsByWeek } = bucketDeathsByWeek(records);

    // Flags use every week of the cycle so the median isn't skewed by a short range.
    const weightFlags = flagWeights(Object.entries(weightsByWeek).map(([week, w]) => ({ week: Number(week), avgWeightG: w.sum / w.count })));

    // Every week from the range start to its end (capped at the current week), including weeks with no records.
    const weekOf = (ms) => Math.floor((ms - cycleStart.getTime()) / WEEK_MS) + 1;
    const weeks = [];
    for (let week = Math.max(1, weekOf(sinceMs)); week <= weekOf(Math.min(untilMs, now)); week++) {
        const startMs = cycleStart.getTime() + (week - 1) * WEEK_MS;
        const w = weightsByWeek[week];
        weeks.push({
            week, startMs, endMs: startMs + WEEK_MS,
            deaths: deathsByWeek[week] || 0,
            avgWeightG: w ? w.sum / w.count : null,
            weightSamples: w ? w.count : 0,
            weightCheck: weightFlags[week] ? "Check entry" : null,
            weightCheckReason: weightFlags[week] || null
        });
    }

    // Deaths logged without a usable weekNumber still happened, so they get their own bucket (by createdAt in range) instead of vanishing.
    const unrecordedInRange = records
        .filter(r => (!Number.isFinite(r.week) || r.week < 1) && inRange(r.createdAtMs, sinceMs, untilMs))
        .reduce((sum, r) => sum + r.deaths, 0);
    if (unrecordedInRange > 0) {
        weeks.push({ week: null, label: "Week not recorded", startMs: null, endMs: null, deaths: unrecordedInRange, avgWeightG: null, weightSamples: 0, weightCheck: null, weightCheckReason: null });
    }

    // Cycle-to-date totals count every record, matching the dashboard card (dashboard.js loadMortalityStat), with its survival clamp.
    const initialStock = Number(growth.initialStock);
    const totalDeaths = records.reduce((sum, r) => sum + r.deaths, 0);
    const hasStock = Number.isFinite(initialStock) && initialStock > 0;
    const survivalPct = hasStock ? Math.max(0, ((initialStock - totalDeaths) / initialStock) * 100) : null;
    return {
        weeks,
        cycleTotals: {
            initialStock: hasStock ? initialStock : null,
            totalDeaths,
            survivalPct,
            mortalityPct: survivalPct === null ? null : 100 - survivalPct,
            confirmedAlive: hasStock ? Math.max(0, Math.round(initialStock - totalDeaths)) : null
        }
    };
}

function gatherYield({ growth, warnings }) {
    if (!growth) {
        warnings.push({ code: "no-cycle", message: "No growth cycle is configured, so there is no yield prediction." });
        return null;
    }
    // wqScore only feeds the separate Efficiency Score, not yield, so it isn't needed here.
    const result = calcYield(growth, null);
    const waterNote = yieldWaterNote(result.rfMode, result.rfWaterSource);
    if (!result.eligible) {
        warnings.push({
            code: "yield-locked",
            message: result.weeksRemaining != null
                ? `Yield prediction unlocks at day 90 of the cycle (about ${result.weeksRemaining} week${result.weeksRemaining === 1 ? "" : "s"} from now).`
                : "Yield prediction needs a cycle start date in Settings."
        });
    } else if (!result.rfAvailable) {
        warnings.push({ code: "yield-processing", message: "The cycle is eligible, but the yield model hasn't produced a prediction yet." });
    } else if (result.rfMode === "test") {
        warnings.push({ code: "yield-test-mode", message: "The yield prediction was generated in test mode and does not reflect real farm data." });
    } else if (waterNote) {
        warnings.push({ code: "yield-synthetic-water", message: waterNote });
    }
    return {
        eligible: result.eligible,
        weeksRemaining: result.weeksRemaining,
        yieldKg: result.adjustedYield,
        revenueMin: result.incomeMin,
        revenueAvg: result.incomeAvg,
        revenueMax: result.incomeMax,
        rfMode: result.rfMode,
        rfWaterSource: result.rfWaterSource,
        rfNote: result.rfNote,
        rfReadingsUsed: result.rfReadingsUsed,
        rfUpdatedAtMs: toMs(result.rfUpdatedAt),
        estimatedHarvestMs: toMs(growth.cycleEnd)
    };
}

async function gatherTasks({ sinceMs, untilMs, warnings }) {
    const { docs, truncated } = await loadByCreatedAtDesc("tasks", sinceMs);
    if (truncated) warnings.push({ code: "tasks-truncated", message: `Only the newest ${MAX_PAGES * PAGE_SIZE} tasks were scanned.` });
    return docs
        .map(snap => {
            const d = snap.data();
            // assign-actions.js stores the raw uid as the name when the user had no fullName.
            const storedName = d.assignedToName && d.assignedToName !== d.assignedTo ? d.assignedToName : "";
            return {
                id: snap.id,
                title: d.title || "",
                description: d.description || "",
                assignee: storedName || (d.createdBy === "system" ? "Unassigned (auto)" : ""),
                assigneeRole: d.assignedToRole || d.assignedRole || "",
                status: normalizeStatus(d.status),
                dueDate: d.dueDate || "",
                createdAtMs: toMs(d.createdAt),
                alertId: d.alertId || ""
            };
        })
        .filter(t => inRange(t.createdAtMs, sinceMs, untilMs));
}

async function gatherLogs({ sinceMs, untilMs, warnings }) {
    const { docs, truncated } = await loadByCreatedAtDesc("logs", sinceMs);
    if (truncated) warnings.push({ code: "logs-truncated", message: `Only the newest ${MAX_PAGES * PAGE_SIZE} logs were scanned.` });
    return docs
        .map(snap => {
            const data = snap.data();
            const { loggedAt, ...rest } = normalizeLogData(data, snap.id);
            // Exported files never carry emails: skip createdByEmail, and treat any email-shaped value as unknown.
            const actor = getTextField(data, REPORT_ACTOR_KEYS, "");
            return { id: snap.id, loggedAtMs: loggedAt ? loggedAt.getTime() : null, ...rest, actor: actor && !EMAIL_RE.test(actor) ? actor : "Unknown user" };
        })
        .filter(l => inRange(l.loggedAtMs, sinceMs, untilMs));
}

// ─── Public entry ───────────────────────────────────────────────────────────

const GATHERERS = {
    waterQuality: gatherWaterQuality,
    alerts: gatherAlerts,
    mortalityGrowth: gatherMortalityGrowth,
    yield: gatherYield,
    tasks: gatherTasks,
    logs: gatherLogs
};

/**
 * gatherReport({ sinceMs, untilMs, sections, onProgress })
 * Returns { meta, sections, summary, warnings }. A failing section becomes null plus a
 * "section-failed" warning so the rest of the report still renders.
 */
export async function gatherReport({ sinceMs, untilMs, sections, onProgress = null }) {
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || sinceMs > untilMs) {
        throw new Error("gatherReport: invalid date range.");
    }
    const unknown = (sections || []).filter(s => !SECTIONS.includes(s));
    if (!sections?.length || unknown.length) {
        throw new Error("gatherReport: choose sections from " + SECTIONS.join(", ") + (unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""));
    }

    const now = Date.now();
    const [growth, generatedBy] = await Promise.all([loadCycleInfo(), loadGeneratedBy(), loadThresholds()]);
    const cycleStartMs = toMs(growth?.cycleStart);

    // Refuse before any HistoryLogs download, whatever the preset; only readings carry a large read cost.
    if (sections.includes("waterQuality")) {
        const budget = checkReadBudget(await estimateNewReads(cycleStartMs, sinceMs, untilMs, now));
        if (!budget.allowed) throw Object.assign(new Error(budget.message), { code: "read-budget" });
    }

    const warnings = [];
    const meta = {
        title: "Bantay Ulang — Farm Report",
        range: { sinceMs, untilMs },
        generatedAtMs: now,
        generatedBy,
        cycle: cycleStartMs == null ? null : {
            startMs: cycleStartMs,
            endMs: toMs(growth.cycleEnd),
            // True once the stored cycleEnd has passed, so callers show "Cycle ended <date>" instead of a day number.
            ended: toMs(growth.cycleEnd) != null && now > toMs(growth.cycleEnd),
            day: Math.floor((now - cycleStartMs) / DAY_MS) + 1,
            initialStock: Number.isFinite(Number(growth.initialStock)) ? Number(growth.initialStock) : null
        },
        sync: null,
        coverage: null,
        excluded: null,
        sources: [
            "Sensor readings: HistoryLogs sensor summaries, from this browser's saved copy or fetched for the range.",
            "Alerts, tasks, logs, mortality and growth records: Firestore."
        ],
        disclaimer: MODEL_DISCLAIMER
    };

    const ctx = { sinceMs, untilMs, cycleStartMs, growth, now, onProgress, meta, warnings };
    const result = {};
    for (const key of sections) {
        if (onProgress) onProgress({ stage: key });
        try {
            result[key] = await GATHERERS[key](ctx);
        } catch (err) {
            console.error(`[reportData] ${key} failed:`, err);
            result[key] = null;
            warnings.push({ code: "section-failed", section: key, error: err.code || null, message: `The ${key} section couldn't be loaded (${err.code || err.message}).` });
        }
    }

    return { meta, sections: result, summary: buildSummary(result, now), warnings };
}
