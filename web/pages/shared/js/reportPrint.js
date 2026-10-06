import {
    READING_FIELDS,
    STATUS_LABELS,
    TASK_STATUS_LABELS,
    SYNC_STATE_TEXT,
    SECTION_TITLES,
    TIME_ZONE_NOTE,
    dateTimeManila,
    dateManila,
    cycleStatus,
    generatedByText,
    alertParamLabel,
    alertTypeLabel,
    alertValueText,
    capitalize,
    cadenceText,
    modelModeLabel,
    weekLabel,
    yesNo
} from "./reportCsv.js";
import { isOverdue } from "./taskStatus.js";

// Printable report (print-to-PDF): a pure HTML builder plus the mount/print/cleanup helper; styles live in css/report-print.css.

const FARM_LOCATION = "Hagonoy, Bulacan";
export const DEFAULT_LOGO_SRC = "../../assets/img/logo-one.png";
const LOGO_TIMEOUT_MS = 3000;
const MISSING = "—";
const DAY_MS = 24 * 60 * 60 * 1000;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ESCAPES[ch]);

const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const num = (value, digits) => isNum(value)
    ? value.toLocaleString("en-PH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : MISSING;
const reading = (field, value) => num(value, READING_FIELDS[field].decimals);
// Never rounds to 100.0% or 0.0% unless exact, so one bad reading out of thousands still shows.
function pct(value) {
    if (!isNum(value)) return MISSING;
    if (value < 100 && value >= 99.95) return "over 99.9%";
    if (value > 0 && value < 0.05) return "under 0.1%";
    return `${num(value, 1)}%`;
}
const peso = (value) => (isNum(value) ? `₱${num(value, 0)}` : MISSING);
const unitSuffix = (field) => (READING_FIELDS[field].unit ? ` (${READING_FIELDS[field].unit})` : "");

// ─── Building blocks ────────────────────────────────────────────────────────

const para = (text, cls = "") => `<p${cls ? ` class="${cls}"` : ""}>${esc(text)}</p>`;
const empty = (text) => para(text, "rp-empty");

// Columns are [header, row => trusted HTML]; a { gap } row spans every column; headers repeat on every printed page via thead.
function table(columns, rows, cls = "") {
    const head = columns.map(([header]) => `<th scope="col">${esc(header)}</th>`).join("");
    const body = rows.map(row => (row.gap
        ? `<tr class="rp-gap"><td colspan="${columns.length}">${esc(row.gap)}</td></tr>`
        : `<tr>${columns.map(([, cell]) => `<td>${cell(row)}</td>`).join("")}</tr>`)).join("");
    return `<table class="rp-table ${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// A text label is always present; the tag class only adds color, so black-and-white prints still read correctly.
const tag = (text, tone) => `<span class="rp-tag rp-tag--${tone}">${esc(text)}</span>`;
const SEVERITY_TONE = { critical: "critical", high: "critical", medium: "warning", low: "info" };

function definitionList(pairs) {
    return `<dl class="rp-facts">${pairs.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`;
}

// Wraps a gathered section; not selected -> nothing, failed (null) -> an honest note instead of an empty table.
function section(report, key, body, cls = "") {
    if (!(key in report.sections)) return "";
    const content = report.sections[key] === null
        ? empty("This section couldn't be loaded. See Notes at the end of the report.")
        : body(report.sections[key]);
    return `<section class="rp-section ${cls}"><h2>${esc(SECTION_TITLES[key])}</h2>${content}</section>`;
}

// ─── Header and summary ─────────────────────────────────────────────────────

function header(meta, logoSrc) {
    const period = `${dateTimeManila(meta.range.sinceMs)} to ${dateTimeManila(meta.range.untilMs)}`;
    return `<header class="rp-header">
        <img class="rp-logo" src="${esc(logoSrc)}" alt="Bantay Ulang logo">
        <div class="rp-brand"><h1>${esc(meta.title)}</h1><p>${esc(FARM_LOCATION)}</p></div>
        ${definitionList([
            ["Period", period],
            ["Cycle", cycleStatus(meta.cycle)],
            ["Generated", `${dateTimeManila(meta.generatedAtMs)} by ${generatedByText(meta.generatedBy)}`]
        ])}
    </header>`;
}

function summaryWaterQuality(report) {
    if (!("waterQuality" in report.sections)) return empty("Water quality wasn't included in this report.");
    if (report.sections.waterQuality === null) return empty("Water quality couldn't be loaded, so there is no summary for it.");
    const params = report.summary.parameters;
    if (!params.some(p => p.n > 0)) return empty("No sensor readings with data were recorded in this period.");
    const level = report.summary.waterLevel;
    return table([
        ["Parameter", p => esc(p.label + (READING_FIELDS[p.param] ? unitSuffix(p.param) : ""))],
        ["Safe range", p => esc(p.safeRange || "Not set")],
        ["Average", p => reading(p.param, p.avg)],
        ["Lowest", p => reading(p.param, p.min)],
        ["Highest", p => reading(p.param, p.max)],
        ["Time in range", p => (p.n === 0 ? "No data" : p.pctInRange === null ? "No range set" : pct(p.pctInRange))]
    ], params, "rp-table--summary") + para(level.n
        ? `Water level was safe in ${pct(level.pctSafe)} of ${level.n.toLocaleString("en-PH")} readings.`
        : "No water level readings were recorded in this period.");
}

// Every slot is always shown, saying so when its section wasn't selected or failed to load.
function keyFacts(report) {
    const { meta, sections, summary } = report;
    const slot = (key, text) => (!(key in sections) ? "Not included in this report" : sections[key] === null ? "Couldn't be loaded" : text());
    const alerts = sections.alerts;
    const totals = sections.mortalityGrowth?.cycleTotals;
    return definitionList([
        ["Sensor coverage", slot("waterQuality", () => `${pct(meta.coverage.pct)} of expected readings`)],
        ["Alerts", slot("alerts", () => `${alerts.groups.length} alert group${alerts.groups.length === 1 ? "" : "s"}, ${alerts.groups.filter(g => g.status === "active").length} still active`)],
        ["Survival this cycle", slot("mortalityGrowth", () => (totals.survivalPct === null ? "Initial stock not set" : `${pct(totals.survivalPct)} (${totals.totalDeaths.toLocaleString("en-PH")} deaths)`))],
        ["Projected yield", slot("yield", () => (sections.yield.yieldKg == null ? "Not available yet" : `${num(sections.yield.yieldKg, 1)} kg`))],
        ["Tasks", slot("tasks", () => `${summary.tasks.total} created, ${summary.tasks.overdue} overdue`)]
    ]);
}

function summaryPage(report) {
    return `<section class="rp-section rp-summary"><h2>Summary</h2>${keyFacts(report)}
        <h3>Water quality at a glance</h3>${summaryWaterQuality(report)}</section>`;
}

// ─── Detail sections ────────────────────────────────────────────────────────

function dailyCell(field, stat) {
    if (!stat || stat.n === 0) return MISSING;
    return `<strong>${reading(field, stat.avg)}</strong><span class="rp-range">${reading(field, stat.min)} – ${reading(field, stat.max)}</span>`;
}

// Daily rows with a spanning note wherever consecutive days with readings are more than one day apart.
function withGaps(daily) {
    const dayNumber = (date) => Date.UTC(...date.split("-").map((part, i) => Number(part) - (i === 1 ? 1 : 0))) / DAY_MS;
    const dateOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
    const rows = [];
    daily.forEach((day, i) => {
        if (i > 0) {
            const from = dayNumber(daily[i - 1].date) + 1;
            const to = dayNumber(day.date) - 1;
            if (to >= from) {
                const days = to - from + 1;
                rows.push({ gap: `No readings ${dateOf(from)}${days > 1 ? ` – ${dateOf(to)}` : ""} (${days} day${days === 1 ? "" : "s"})` });
            }
        }
        rows.push(day);
    });
    return rows;
}

function waterQualityBody(wq) {
    if (!wq.daily.length) return empty("No sensor readings with data were recorded in this period.");
    const columns = [
        ["Date", d => esc(d.date)],
        ["Readings", d => d.readings.toLocaleString("en-PH")],
        ...Object.keys(READING_FIELDS).map(field => [READING_FIELDS[field].label + unitSuffix(field), d => dailyCell(field, d.params[field])]),
        [STATUS_LABELS["out-of-range"], d => String(d.outOfRange)],
        ["Faulty Values", d => String(d.suspect)]
    ];
    return para("Each cell shows the day's average in bold, with the lowest and highest reading below it. Faulty (physically impossible) values are left out.", "rp-hint")
        + table(columns, withGaps(wq.daily), "rp-table--daily");
}

function alertsBody(alerts) {
    if (!alerts.groups.length) return empty("No alerts in this period.");
    return para("Repeats of the same alert within an hour are combined into one row.", "rp-hint") + table([
        ["Status", g => tag(capitalize(g.status), g.status === "active" ? "critical" : "neutral")],
        ["Alert", g => esc(alertTypeLabel(g.type) || MISSING)],
        ["Parameter", g => esc(alertParamLabel(g.parameter))],
        ["Severity", g => tag(capitalize(g.severity) || MISSING, SEVERITY_TONE[g.severity] || "neutral")],
        ["Times", g => String(g.occurrences)],
        ["First seen", g => esc(dateTimeManila(g.firstMs) ?? MISSING)],
        ["Last seen", g => esc(dateTimeManila(g.lastMs) ?? MISSING)],
        ["Last value", g => esc(alertValueText(g) ?? MISSING) + (g.valueSuspect ? `<span class="rp-note">Value looks faulty</span>` : "")],
        ["Handled", g => yesNo(g.handled)]
    ], alerts.groups);
}

function mortalityBody(mg) {
    const totals = mg.cycleTotals;
    const totalsText = totals.initialStock === null
        ? `${totals.totalDeaths.toLocaleString("en-PH")} deaths recorded this cycle (initial stock not set).`
        : `${totals.totalDeaths.toLocaleString("en-PH")} deaths this cycle out of ${totals.initialStock.toLocaleString("en-PH")} stocked: ${pct(totals.survivalPct)} survival, about ${totals.confirmedAlive.toLocaleString("en-PH")} alive.`;
    if (!mg.weeks.length) return para(totalsText) + empty("No cycle weeks fall in this period.");
    return para(totalsText) + table([
        ["Week", w => esc(weekLabel(w))],
        ["Dates", w => (w.startMs === null ? MISSING : `${esc(dateManila(w.startMs))} to ${esc(dateManila(w.endMs - 1))}`)],
        ["Deaths", w => w.deaths.toLocaleString("en-PH")],
        ["Average weight (g)", w => num(w.avgWeightG, 1)],
        ["Samples", w => String(w.weightSamples)],
        ["Weight check", w => (w.weightCheck ? `${tag("! " + w.weightCheck, "warning")}<span class="rp-note">${esc(w.weightCheckReason)}</span>` : "")]
    ], mg.weeks) + para("\"Check entry\" marks a weekly average above 5 g + 5 g per week, or above 3 times the median weekly average. The weight is kept as recorded; please re-check the entry. These limits are provisional pending the adviser's confirmation.", "rp-hint");
}

function yieldBody(y, meta) {
    const ended = meta.cycle?.ended ? para(`The cycle ended on ${dateManila(meta.cycle.endMs)}. The figures below are the last prediction made.`) : "";
    if (!y.eligible) {
        return ended + empty(y.weeksRemaining == null
            ? "Yield prediction needs a cycle start date in Settings."
            : `Available after day 90 of the cycle (about ${y.weeksRemaining} week${y.weeksRemaining === 1 ? "" : "s"} from now).`);
    }
    if (y.yieldKg == null) return ended + empty("The cycle is past day 90, but the yield model hasn't produced a prediction yet.");
    return ended + definitionList([
        ["Projected yield", `${num(y.yieldKg, 1)} kg`],
        ["Estimated revenue", `${peso(y.revenueMin)} – ${peso(y.revenueMax)} (average ${peso(y.revenueAvg)})`],
        ["Estimated harvest", dateManila(y.estimatedHarvestMs) ?? MISSING],
        ["Model", `${modelModeLabel(y.rfMode, y.rfWaterSource) || MISSING}${y.rfUpdatedAtMs ? `, updated ${dateTimeManila(y.rfUpdatedAtMs)}` : ""}`]
    ]) + para("These are model estimates, not guarantees. See the disclaimer in Notes.", "rp-hint");
}

function tasksBody(tasks, report) {
    if (!tasks.length) return empty("No tasks were created in this period.");
    const counts = report.summary.tasks;
    const overdue = tasks.filter(t => isOverdue(t, report.meta.generatedAtMs));
    return table([
        [TASK_STATUS_LABELS.pending, c => String(c.pending)],
        [TASK_STATUS_LABELS["in-progress"], c => String(c["in-progress"])],
        [TASK_STATUS_LABELS.completed, c => String(c.completed)],
        ["Overdue", c => String(c.overdue)],
        ["Total", c => String(c.total)]
    ], [counts], "rp-table--counts") + (overdue.length ? "<h3>Overdue tasks</h3>" + table([
        ["Task", t => esc(t.title)],
        ["Assigned to", t => esc(t.assignee || "Unassigned")],
        ["Due date", t => esc(t.dueDate)],
        ["Status", t => esc(TASK_STATUS_LABELS[t.status])]
    ], overdue) : para("No overdue tasks."));
}

function logsBody(logs) {
    if (!logs.length) return empty("No activity logs in this period.");
    return table([
        ["Date and time", l => esc(dateTimeManila(l.loggedAtMs) ?? MISSING)],
        ["By", l => esc(l.actor)],
        ["Type", l => esc(capitalize(l.type))],
        ["Details", l => esc([l.title, l.description].filter(Boolean).join(": "))]
    ], logs);
}

function notes(report) {
    const { meta, warnings } = report;
    const items = [TIME_ZONE_NOTE + "."];
    if (meta.coverage) {
        const c = meta.coverage;
        items.push(`Sensor readings with data: ${c.actual.toLocaleString("en-PH")} of ${c.expected.toLocaleString("en-PH")} expected (${pct(c.pct)}).`);
        items.push(`Expected readings assume ${cadenceText(c)}.`);
        items.push(`Empty readings skipped (no sensor values): ${c.noDataSkipped.toLocaleString("en-PH")}.`);
        items.push(`Readings with a physically impossible (faulty) value: ${c.suspect.toLocaleString("en-PH")}. Those values are left out of every figure.`);
    }
    if (meta.sync) items.push(`Readings source: ${SYNC_STATE_TEXT[meta.sync.state] || meta.sync.state}.`);
    if (meta.excluded) items.push(`Duplicate alerts excluded: ${meta.excluded.duplicateAlerts}.`);
    warnings.forEach(w => items.push(w.message));
    items.push(meta.disclaimer);
    meta.sources.forEach(source => items.push(source));
    return `<section class="rp-section rp-notes"><h2>Notes</h2><ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul></section>`;
}

// Full report markup; every value from Firestore goes through esc().
export function buildReportHtml(report, { logoSrc = DEFAULT_LOGO_SRC } = {}) {
    return [
        header(report.meta, logoSrc),
        summaryPage(report),
        section(report, "waterQuality", waterQualityBody, "rp-break"),
        section(report, "alerts", alertsBody),
        section(report, "mortalityGrowth", mortalityBody),
        section(report, "yield", y => yieldBody(y, report.meta)),
        section(report, "tasks", t => tasksBody(t, report)),
        section(report, "logs", logsBody),
        notes(report)
    ].join("");
}

// Chrome uses the document title as the suggested PDF file name.
export function reportDocTitle(meta) {
    return `bantay-ulang_report_${dateManila(meta.range.sinceMs)}_${dateManila(meta.range.untilMs)}`;
}

// ─── Browser: mount, print, clean up ────────────────────────────────────────

// Inserts #reportPrint and switches print styles to it; returns the cleanup function.
export function mountReportPrint(report, { logoSrc = DEFAULT_LOGO_SRC } = {}) {
    document.getElementById("reportPrint")?.remove();
    const root = document.createElement("div");
    root.id = "reportPrint";
    root.innerHTML = buildReportHtml(report, { logoSrc });
    document.body.appendChild(root);
    const previousTitle = document.title;
    document.title = reportDocTitle(report.meta);
    document.documentElement.classList.add("is-printing-report");
    return () => {
        root.remove();
        document.title = previousTitle;
        document.documentElement.classList.remove("is-printing-report");
    };
}

// Resolves once the logo has loaded; a logo that fails or is slow is dropped rather than printed broken.
async function waitForLogo(root) {
    const img = root.querySelector(".rp-logo");
    if (!img) return;
    if (!img.complete) {
        await Promise.race([
            new Promise(resolve => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); }),
            new Promise(resolve => setTimeout(resolve, LOGO_TIMEOUT_MS))
        ]);
    }
    if (!img.complete || img.naturalWidth === 0) img.remove();
}

// Opens the print dialog for the report and resolves after it closes (printed, saved or cancelled).
export async function printReport(report, options = {}) {
    const cleanup = mountReportPrint(report, options);
    await waitForLogo(document.getElementById("reportPrint"));
    await new Promise(resolve => {
        window.addEventListener("afterprint", resolve, { once: true });
        window.print();
    });
    cleanup();
}
