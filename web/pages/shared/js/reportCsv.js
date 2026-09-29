import { isOverdue } from "./taskStatus.js";

// CSV export for gatherReport() output: pure builders plus one browser download helper.
// The plain-language labels and number formats are exported so the printed report reads the same.

const BOM = "﻿";
const EOL = "\r\n";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Philippines is UTC+8 with no daylight saving.
export const TIME_ZONE_NOTE = "All times are Philippine time (UTC+8)";

// Report reading field -> label, unit and decimals shown.
export const READING_FIELDS = {
    ph:              { label: "pH",                unit: "",     decimals: 2 },
    waterTemp:       { label: "Water Temperature", unit: "°C",   decimals: 1 },
    dissolvedOxygen: { label: "Dissolved Oxygen",  unit: "mg/L", decimals: 2 },
    salinity:        { label: "Salinity",          unit: "ppt",  decimals: 2 },
    turbidity:       { label: "Turbidity",         unit: "NTU",  decimals: 1 },
    tds:             { label: "TDS",               unit: "ppm",  decimals: 0 }
};

export const STATUS_LABELS = { "normal": "Normal", "out-of-range": "Out of Range", "suspect": "Suspect", "incomplete": "Incomplete", "no-data": "No Data" };
export const TASK_STATUS_LABELS = { "pending": "Pending", "in-progress": "In Progress", "completed": "Completed" };
// predict_yield.py rfMode: real = live water + measured weight, hybrid = live water + assumed start weight, test = assumed optimal water.
const MODEL_MODE_LABELS = { real: "Live data", hybrid: "Live water data, assumed weight", test: "Test mode" };
const ALERT_TYPE_LABELS = { out_of_range: "Out of Range", critical_out_of_range: "Critical Out of Range", hardware_offline: "Sensor Offline" };
// Live alert docs use thresholds.js keys (phLevel), so both spellings are listed.
const ALERT_PARAM_FIELD = { phLevel: "ph", ph: "ph", waterTemp: "waterTemp", dissolvedOxygen: "dissolvedOxygen", salinity: "salinity", turbidity: "turbidity", tds: "tds" };
const ALERT_PARAM_LABELS = { waterLevel: "Water Level", hardware: "Sensor Hardware" };

const SECTION_SLUGS = {
    waterQuality:    "water-quality",
    alerts:          "alerts",
    mortalityGrowth: "mortality-growth",
    yield:           "yield",
    tasks:           "tasks",
    logs:            "logs"
};

// ─── Value formatting ───────────────────────────────────────────────────────

// Spreadsheet apps run text starting with these as a formula (OWASP CSV injection list).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// One RFC 4180 cell: missing values are empty, text is injection-guarded and quoted only when needed.
export function csvCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return value ? "true" : "false";
    let text = String(value);
    if (FORMULA_PREFIX.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// BOM + header row + data rows, CRLF-terminated; columns are [header, row => value] pairs.
export function toCsv(columns, rows) {
    const lines = [columns.map(([header]) => csvCell(header)).join(",")];
    for (const row of rows) lines.push(columns.map(([, get]) => csvCell(get(row))).join(","));
    return BOM + lines.join(EOL) + EOL;
}

const manilaIso = (ms) => (typeof ms === "number" && Number.isFinite(ms)) ? new Date(ms + MANILA_OFFSET_MS).toISOString() : null;

// "2026-09-14 13:13" in Philippine time, whatever the browser's time zone.
export function dateTimeManila(ms) {
    const iso = manilaIso(ms);
    return iso ? iso.slice(0, 10) + " " + iso.slice(11, 16) : null;
}

export function dateManila(ms) {
    const iso = manilaIso(ms);
    return iso ? iso.slice(0, 10) : null;
}

export const round = (value, digits) => (typeof value === "number" && Number.isFinite(value)) ? Number(value.toFixed(digits)) : null;
export const formatReading = (field, value) => round(value, READING_FIELDS[field]?.decimals ?? 2);
export const yesNo = (value) => (value ? "Yes" : "No");
export const readingHeader = (field) => READING_FIELDS[field].label + (READING_FIELDS[field].unit ? ` (${READING_FIELDS[field].unit})` : "");
export const alertParamLabel = (param) => READING_FIELDS[ALERT_PARAM_FIELD[param]]?.label || ALERT_PARAM_LABELS[param] || param;
export const alertTypeLabel = (type) => ALERT_TYPE_LABELS[type] || type;
export const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : "");
export const modelModeLabel = (mode) => MODEL_MODE_LABELS[mode] || capitalize(mode);

// Last value of an alert group in its reading's units; water level is Safe/Unsafe and hardware stays as stored text.
export function alertValueText(group) {
    const value = group.lastValue;
    if (typeof value === "boolean") return value ? "Safe" : "Unsafe";
    const field = ALERT_PARAM_FIELD[group.parameter];
    if (typeof value === "number" && field) {
        const unit = READING_FIELDS[field].unit;
        return String(formatReading(field, value)) + (unit ? " " + unit : "");
    }
    return value ?? null;
}

export const weekLabel = (w) => (w.week === null ? w.label : `Week ${w.week}`);
export const weightCheckText = (w) => (w.weightCheck ? `${w.weightCheck}: ${w.weightCheckReason}` : null);
const waterLevelText = (value) => (typeof value === "boolean" ? (value ? "Safe" : "Unsafe") : null);

// ─── Section tables ─────────────────────────────────────────────────────────

const WATER_QUALITY_COLUMNS = [
    ["Date and Time", r => dateTimeManila(r.measuredAtMs)],
    ...Object.keys(READING_FIELDS).map(field => [readingHeader(field), r => formatReading(field, r[field])]),
    ["Water Level", r => waterLevelText(r.waterLevel)],
    ["Status", r => STATUS_LABELS[r.status] || r.status],
    ["Faulty Values", r => (r.suspectFields || []).map(f => READING_FIELDS[f]?.label || f).join("; ")]
];

const ALERT_COLUMNS = [
    ["Status", g => capitalize(g.status)],
    ["Alert", g => alertTypeLabel(g.type)],
    ["Parameter", g => alertParamLabel(g.parameter)],
    ["Highest Severity", g => capitalize(g.severity)],
    ["Occurrences", g => g.occurrences],
    ["First Seen", g => dateTimeManila(g.firstMs)],
    ["Last Seen", g => dateTimeManila(g.lastMs)],
    ["Resolved At", g => dateTimeManila(g.resolvedAtMs)],
    ["Last Value", g => alertValueText(g)],
    ["Value Looks Faulty", g => yesNo(g.valueSuspect)],
    ["Safe Range", g => g.safeRange],
    ["Handled", g => yesNo(g.handled)],
    ["Message", g => g.message]
];

const MORTALITY_GROWTH_COLUMNS = [
    ["Week", weekLabel],
    ["Week Start", w => dateManila(w.startMs)],
    ["Week End", w => dateManila(w.endMs === null ? null : w.endMs - 1)],
    ["Deaths", w => w.deaths],
    ["Average Weight (g)", w => round(w.avgWeightG, 1)],
    ["Weight Samples", w => w.weightSamples],
    ["Weight Check", weightCheckText]
];

const YIELD_COLUMNS = [
    ["Prediction Available", y => yesNo(y.eligible)],
    ["Weeks Until Available", y => y.weeksRemaining],
    ["Projected Yield (kg)", y => round(y.yieldKg, 1)],
    ["Revenue Low (PHP)", y => round(y.revenueMin, 0)],
    ["Revenue Average (PHP)", y => round(y.revenueAvg, 0)],
    ["Revenue High (PHP)", y => round(y.revenueMax, 0)],
    ["Model Mode", y => modelModeLabel(y.rfMode)],
    ["Model Note", y => y.rfNote],
    ["Readings Used", y => y.rfReadingsUsed],
    ["Model Updated", y => dateTimeManila(y.rfUpdatedAtMs)],
    ["Estimated Harvest", y => dateManila(y.estimatedHarvestMs)]
];

const TASK_COLUMNS = [
    ["Created", t => dateTimeManila(t.createdAtMs)],
    ["Title", t => t.title],
    ["Description", t => t.description],
    ["Assigned To", t => t.assignee],
    ["Role", t => capitalize(t.assigneeRole)],
    ["Status", t => TASK_STATUS_LABELS[t.status] || t.status],
    ["Due Date", t => t.dueDate],
    ["Overdue", t => yesNo(t.overdue)]
];

const LOG_COLUMNS = [
    ["Date and Time", l => dateTimeManila(l.loggedAtMs)],
    ["Type", l => capitalize(l.type)],
    ["By", l => l.actor],
    ["Title", l => l.title],
    ["Details", l => l.description]
];

// Section key -> [columns, rows from the gathered section and the report].
const SECTION_TABLES = {
    waterQuality:    [WATER_QUALITY_COLUMNS, s => s.rows],
    alerts:          [ALERT_COLUMNS, s => s.groups],
    mortalityGrowth: [MORTALITY_GROWTH_COLUMNS, s => s.weeks],
    yield:           [YIELD_COLUMNS, s => [s]],
    tasks:           [TASK_COLUMNS, (s, report) => s.map(t => ({ ...t, overdue: isOverdue(t, report.meta.generatedAtMs) }))],
    logs:            [LOG_COLUMNS, s => s]
};

// ─── Report info ────────────────────────────────────────────────────────────

export const SYNC_STATE_TEXT = {
    "cache":        "Saved readings in this browser (no download)",
    "catch-up":     "Saved readings, topped up from the server",
    "direct-range": "Downloaded for this range (not saved)",
    "partial":      "Incomplete download",
    "cache-only":   "Server unreachable; saved readings only"
};

export const SECTION_TITLES = {
    waterQuality:    "Water Quality",
    alerts:          "Alerts",
    mortalityGrowth: "Mortality and Growth",
    yield:           "Yield Prediction",
    tasks:           "Tasks",
    logs:            "Activity Logs"
};

// "Cycle ended <date>" once the stored end has passed, never a day number past the cycle length.
export function cycleStatus(cycle) {
    if (!cycle) return "No cycle start date set";
    if (cycle.ended) return `Cycle ended ${dateManila(cycle.endMs)}`;
    return `Day ${cycle.day}`;
}

export const generatedByText = (by) => (by.role ? `${by.name} (${capitalize(by.role)})` : by.name);

// Item/value rows describing the report itself; one row per note and data source.
export function buildReportInfoRows(report, files) {
    const { meta, sections, warnings } = report;
    const rows = [
        ["Report", meta.title],
        ["Time Zone", TIME_ZONE_NOTE],
        ["Period Start", dateTimeManila(meta.range.sinceMs)],
        ["Period End", dateTimeManila(meta.range.untilMs)],
        ["Cycle Start", dateManila(meta.cycle?.startMs)],
        ["Cycle Status", cycleStatus(meta.cycle)],
        ["Initial Stock", meta.cycle?.initialStock],
        ["Generated At", dateTimeManila(meta.generatedAtMs)],
        ["Generated By", generatedByText(meta.generatedBy)],
        ["Sections", Object.keys(sections).map(key => SECTION_TITLES[key] || key).join("; ")],
        ["Files", files.join("; ")]
    ];
    if (meta.sync) {
        rows.push(
            ["Readings Source", SYNC_STATE_TEXT[meta.sync.state] || meta.sync.state],
            ["Readings Downloaded", meta.sync.docsRead]
        );
    }
    if (meta.coverage) {
        rows.push(
            ["Expected Readings", meta.coverage.expected],
            ["Readings With Data", meta.coverage.actual],
            ["Coverage (%)", round(meta.coverage.pct, 1)],
            ["Readings With Faulty Values", meta.coverage.suspect],
            ["Empty Readings Skipped", meta.coverage.noDataSkipped]
        );
    }
    if (meta.excluded) rows.push(["Duplicate Alerts Excluded", meta.excluded.duplicateAlerts]);
    const totals = sections.mortalityGrowth?.cycleTotals;
    if (totals) {
        rows.push(
            ["Total Deaths This Cycle", totals.totalDeaths],
            ["Survival This Cycle (%)", round(totals.survivalPct, 1)],
            ["Confirmed Alive", totals.confirmedAlive]
        );
    }
    warnings.forEach(w => rows.push(["Note", w.message]));
    meta.sources.forEach(source => rows.push(["Data Source", source]));
    rows.push(["Model Disclaimer", meta.disclaimer]);
    return rows;
}

// ─── Files ──────────────────────────────────────────────────────────────────

export function reportFilename(slug, sinceMs, untilMs) {
    return `bantay-ulang_${slug}_${dateManila(sinceMs)}_${dateManila(untilMs)}.csv`;
}

// One { filename, text } per gathered section (failed sections are skipped), then the report-info file.
export function buildReportFiles(report) {
    const { sinceMs, untilMs } = report.meta.range;
    const files = [];
    for (const [key, section] of Object.entries(report.sections)) {
        if (section == null || !SECTION_TABLES[key]) continue;
        const [columns, rowsOf] = SECTION_TABLES[key];
        files.push({ filename: reportFilename(SECTION_SLUGS[key], sinceMs, untilMs), text: toCsv(columns, rowsOf(section, report)) });
    }
    const infoName = reportFilename("report-info", sinceMs, untilMs);
    const infoRows = buildReportInfoRows(report, [...files.map(f => f.filename), infoName]);
    files.push({ filename: infoName, text: toCsv([["Item", r => r[0]], ["Value", r => r[1]]], infoRows) });
    return files;
}

// Downloads files one after another (Chrome may ask once to allow multiple downloads); shouldStop() ends it early.
export async function downloadFiles(files, { gapMs = 400, shouldStop = () => false } = {}) {
    for (const [i, { filename, text }] of files.entries()) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, gapMs));
        if (shouldStop()) return;
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
}
