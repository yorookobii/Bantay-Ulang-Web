import { calcWaterQualityScore, scoreStatus } from "./waterQualityScore.js";
import { breachDirection } from "./readingStatus.js";
import { isSuspect } from "./plausibility.js";
import { formatWaterLevelText } from "./aquaponicsReading.js";

// Dashboard Water Condition card: score and failing params from the Dashboard's own live snapshot (no reads), textContent only.

// Live-doc key -> readingStatus param, labels and display format; water level is handled separately (boolean).
const NUMERIC_ROWS = [
    { key: "phLevel",         param: "ph",              label: "pH Level",     short: "pH",        dec: 2, unit: "" },
    { key: "waterTemp",       param: "waterTemp",       label: "Water Temp",   short: "Temp",      dec: 1, unit: " °C" },
    { key: "dissolvedOxygen", param: "dissolvedOxygen", label: "Dissolved O₂", short: "DO",        dec: 2, unit: " mg/L" },
    { key: "salinity",        param: "salinity",        label: "Salinity",     short: "Salinity",  dec: 2, unit: " ppt" },
    { key: "turbidity",       param: "turbidity",       label: "Turbidity",    short: "Turbidity", dec: 1, unit: " NTU" }
];
const STATE_TEXT = { low: "↓ Low", high: "↑ High" };
const DIM_LABEL = { stale: "Stale", offline: "Offline" };

// One row per parameter: { label, short, value, state, tone, issue } with tone ok | bad | warn | none and issue set only when failing.
export function breakdownRows(data) {
    const rows = NUMERIC_ROWS.map(({ key, param, label, short, dec, unit }) => {
        const v = data?.[key];
        if (typeof v !== "number" || !Number.isFinite(v)) return { label, short, value: "--", state: "No data", tone: "none", issue: null };
        const value = v.toFixed(dec) + unit;
        if (isSuspect(param, v)) return { label, short, value, state: "Suspect", tone: "warn", issue: "suspect" };
        const dir = breachDirection(param, v);
        return dir
            ? { label, short, value, state: STATE_TEXT[dir], tone: "bad", issue: dir }
            : { label, short, value, state: "In range", tone: "ok", issue: null };
    });
    const level = typeof data?.waterLevel === "boolean" ? data.waterLevel : null;
    rows.push({
        label: "Water Level",
        short: "Water level",
        value: formatWaterLevelText(level),
        state: level == null ? "No data" : level ? "In range" : "Out of range",
        tone: level == null ? "none" : level ? "ok" : "bad",
        issue: level === false ? "unsafe" : null
    });
    return rows;
}

// Counts and failing list for the card: { inRange, withData, failing: "pH low · Temp suspect", tone }.
export function conditionSummary(data) {
    const rows = breakdownRows(data);
    const failingRows = rows.filter(r => r.issue);
    return {
        inRange: rows.filter(r => r.tone === "ok").length,
        withData: rows.filter(r => r.tone !== "none").length,
        failing: failingRows.map(r => `${r.short} ${r.issue}`).join(" · "),
        tone: failingRows.some(r => r.tone === "bad") ? "bad" : failingRows.length ? "warn" : "ok"
    };
}

/** Paints the card; data is the normalized live doc (or null), freshness is { state } from the hardware monitor. */
export function renderWaterCondition(data, freshness) {
    const card = document.getElementById("waterConditionCard");
    if (!card) return;
    const pctEl = document.getElementById("wcPct");
    const statusEl = document.getElementById("wcStatus");
    const countEl = document.getElementById("wcCount");
    const summaryEl = document.getElementById("wcSummary");

    const score = data ? calcWaterQualityScore(data) : null;
    const pct = score == null ? null : Math.round(score * 100);
    const status = pct == null ? null : scoreStatus(pct);
    const dim = freshness?.state !== "online";
    const sum = conditionSummary(data);

    // Old data never gets the OPTIMAL/GOOD colour or word; it is greyed and labelled Stale/Offline.
    card.classList.toggle("wc--dim", dim);
    pctEl.textContent = pct == null ? "--" : pct + "%";
    statusEl.textContent = dim ? (DIM_LABEL[freshness?.state] || "Offline") : status ? status.label : "No data";
    statusEl.style.color = dim || !status ? "" : status.color;
    countEl.textContent = !data ? "No live data"
        : sum.withData ? `${sum.inRange} of ${sum.withData} in range${dim ? " · last known" : ""}` : "No readings with data";
    summaryEl.textContent = sum.withData ? sum.failing || "All in range" : "";
    summaryEl.className = `wc-summary wc-summary--${sum.withData ? sum.tone : "none"}`;
}
