// CSV export for gatherReport() output: pure builders plus one browser download helper.

const BOM = "﻿";
const EOL = "\r\n";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Philippines is UTC+8 with no daylight saving.

// Report field -> CSV column, shared by the readings columns and suspect_fields.
const READING_COLUMNS = {
    ph:              "ph",
    waterTemp:       "water_temp_c",
    dissolvedOxygen: "dissolved_oxygen_mg_l",
    salinity:        "salinity_ppt",
    turbidity:       "turbidity_ntu",
    tds:             "tds_ppm"
};

const SECTION_SLUGS = {
    waterQuality:    "water-quality",
    alerts:          "alerts",
    mortalityGrowth: "mortality-growth",
    yield:           "yield",
    tasks:           "tasks",
    logs:            "logs"
};

// ─── Cell formatting ────────────────────────────────────────────────────────

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

// ISO 8601 in Philippine time, e.g. 2026-09-14T13:13:00+08:00, whatever the browser's time zone.
export function isoManila(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
    return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 19) + "+08:00";
}

export function dateManila(ms) {
    const iso = isoManila(ms);
    return iso ? iso.slice(0, 10) : null;
}

const round = (value, digits) => (typeof value === "number" && Number.isFinite(value)) ? Number(value.toFixed(digits)) : null;

// ─── Section tables ─────────────────────────────────────────────────────────

const WATER_QUALITY_COLUMNS = [
    ["measured_at", r => isoManila(r.measuredAtMs)],
    ...Object.entries(READING_COLUMNS).map(([field, column]) => [column, r => r[field]]),
    ["water_level_safe", r => r.waterLevel],
    ["status", r => r.status],
    ["suspect_fields", r => (r.suspectFields || []).map(f => READING_COLUMNS[f] || f).join(";")]
];

const ALERT_COLUMNS = [
    ["alert_id", a => a.id],
    ["status", a => a.status],
    ["handled", a => a.handled],
    ["type", a => a.type],
    ["parameter", a => a.parameter],
    ["severity", a => a.severity],
    ["current_value", a => a.currentValue],
    ["safe_range", a => a.safeRange],
    ["message", a => a.message],
    ["created_at", a => isoManila(a.createdAtMs)],
    ["resolved_at", a => isoManila(a.resolvedAtMs)],
    ["handled_at", a => isoManila(a.handledAtMs)]
];

const MORTALITY_GROWTH_COLUMNS = [
    ["week", w => w.week],
    ["week_label", w => w.week === null ? w.label : `Week ${w.week}`],
    ["week_start", w => dateManila(w.startMs)],
    ["week_end", w => dateManila(w.endMs === null ? null : w.endMs - 1)],
    ["deaths", w => w.deaths],
    ["avg_weight_g", w => round(w.avgWeightG, 2)],
    ["weight_samples", w => w.weightSamples]
];

const YIELD_COLUMNS = [
    ["eligible", y => y.eligible],
    ["weeks_until_eligible", y => y.weeksRemaining],
    ["projected_yield_kg", y => round(y.yieldKg, 1)],
    ["revenue_min_php", y => round(y.revenueMin, 0)],
    ["revenue_avg_php", y => round(y.revenueAvg, 0)],
    ["revenue_max_php", y => round(y.revenueMax, 0)],
    ["model_mode", y => y.rfMode],
    ["model_note", y => y.rfNote],
    ["readings_used", y => y.rfReadingsUsed],
    ["model_updated_at", y => isoManila(y.rfUpdatedAtMs)],
    ["estimated_harvest", y => dateManila(y.estimatedHarvestMs)]
];

const TASK_COLUMNS = [
    ["task_id", t => t.id],
    ["created_at", t => isoManila(t.createdAtMs)],
    ["title", t => t.title],
    ["description", t => t.description],
    ["assignee", t => t.assignee],
    ["assignee_role", t => t.assigneeRole],
    ["status", t => t.status],
    ["due_date", t => t.dueDate],
    ["alert_id", t => t.alertId]
];

const LOG_COLUMNS = [
    ["log_id", l => l.id],
    ["logged_at", l => isoManila(l.loggedAtMs)],
    ["type", l => l.type],
    ["actor", l => l.actor],
    ["title", l => l.title],
    ["description", l => l.description]
];

// Section key -> [columns, rows from the gathered section].
const SECTION_TABLES = {
    waterQuality:    [WATER_QUALITY_COLUMNS, s => s.rows],
    alerts:          [ALERT_COLUMNS, s => [...s.active, ...s.resolved]],
    mortalityGrowth: [MORTALITY_GROWTH_COLUMNS, s => s.weeks],
    yield:           [YIELD_COLUMNS, s => [s]],
    tasks:           [TASK_COLUMNS, s => s],
    logs:            [LOG_COLUMNS, s => s]
};

// ─── Report info ────────────────────────────────────────────────────────────

const SYNC_STATE_TEXT = {
    "cache":        "Saved readings in this browser (no download)",
    "catch-up":     "Saved readings, topped up from the server",
    "direct-range": "Downloaded for this range (not saved)",
    "partial":      "Incomplete download",
    "cache-only":   "Server unreachable; saved readings only"
};

function cycleStatus(cycle) {
    if (!cycle) return "No cycle start date set";
    if (cycle.ended) return `Cycle ended ${dateManila(cycle.endMs)}`;
    return `Day ${cycle.day}`;
}

// Key/value rows describing the report itself; one row per warning and data source.
export function buildReportInfoRows(report, files) {
    const { meta, sections, warnings } = report;
    const rows = [
        ["title", meta.title],
        ["range_start", isoManila(meta.range.sinceMs)],
        ["range_end", isoManila(meta.range.untilMs)],
        ["cycle_start", dateManila(meta.cycle?.startMs)],
        ["cycle_status", cycleStatus(meta.cycle)],
        ["initial_stock", meta.cycle?.initialStock],
        ["generated_at", isoManila(meta.generatedAtMs)],
        ["generated_by", meta.generatedBy.role ? `${meta.generatedBy.name} (${meta.generatedBy.role})` : meta.generatedBy.name],
        ["sections", Object.keys(sections).join(";")],
        ["files", files.join(";")]
    ];
    if (meta.sync) {
        rows.push(
            ["sync_state", `${meta.sync.state}: ${SYNC_STATE_TEXT[meta.sync.state] || ""}`],
            ["readings_downloaded", meta.sync.docsRead]
        );
    }
    if (meta.coverage) {
        rows.push(
            ["coverage_expected_readings", meta.coverage.expected],
            ["coverage_actual_readings", meta.coverage.actual],
            ["coverage_pct", round(meta.coverage.pct, 1)],
            ["suspect_readings", meta.coverage.suspect],
            ["no_data_readings", meta.coverage.noData]
        );
    }
    const totals = sections.mortalityGrowth?.cycleTotals;
    if (totals) {
        rows.push(
            ["cycle_total_deaths", totals.totalDeaths],
            ["cycle_survival_pct", round(totals.survivalPct, 1)],
            ["cycle_confirmed_alive", totals.confirmedAlive]
        );
    }
    warnings.forEach(w => rows.push(["warning", w.message]));
    meta.sources.forEach(source => rows.push(["data_source", source]));
    rows.push(["model_disclaimer", meta.disclaimer]);
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
        files.push({ filename: reportFilename(SECTION_SLUGS[key], sinceMs, untilMs), text: toCsv(columns, rowsOf(section)) });
    }
    const infoName = reportFilename("report-info", sinceMs, untilMs);
    const infoRows = buildReportInfoRows(report, [...files.map(f => f.filename), infoName]);
    files.push({ filename: infoName, text: toCsv([["key", r => r[0]], ["value", r => r[1]]], infoRows) });
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
