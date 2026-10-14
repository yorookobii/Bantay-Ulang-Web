import { calcWaterQualityScore, scoreStatus } from "./waterQualityScore.js";
import { breachDirection } from "./readingStatus.js";
import { isSuspect } from "./plausibility.js";
import { formatWaterLevelText } from "./aquaponicsReading.js";

// Dashboard Water Condition panel: score and breakdown from the Dashboard's own live snapshot (no reads), textContent only.

// Live-doc key -> readingStatus param, label and display format; water level is handled separately (boolean).
const NUMERIC_ROWS = [
    { key: "phLevel",         param: "ph",              label: "pH Level",     dec: 2, unit: "" },
    { key: "waterTemp",       param: "waterTemp",       label: "Water Temp",   dec: 1, unit: " °C" },
    { key: "dissolvedOxygen", param: "dissolvedOxygen", label: "Dissolved O₂", dec: 2, unit: " mg/L" },
    { key: "salinity",        param: "salinity",        label: "Salinity",     dec: 2, unit: " ppt" },
    { key: "turbidity",       param: "turbidity",       label: "Turbidity",    dec: 1, unit: " NTU" }
];
const STATE_TEXT = { low: "↓ Low", high: "↑ High" };
const DIM_LABEL = { stale: "Stale", offline: "Offline" };

// One row per parameter: { label, value, state, tone } with tone ok | bad | warn | none.
export function breakdownRows(data) {
    const rows = NUMERIC_ROWS.map(({ key, param, label, dec, unit }) => {
        const v = data?.[key];
        if (typeof v !== "number" || !Number.isFinite(v)) return { label, value: "--", state: "No data", tone: "none" };
        const value = v.toFixed(dec) + unit;
        if (isSuspect(param, v)) return { label, value, state: "Suspect", tone: "warn" };
        const dir = breachDirection(param, v);
        return dir ? { label, value, state: STATE_TEXT[dir], tone: "bad" } : { label, value, state: "In range", tone: "ok" };
    });
    const level = typeof data?.waterLevel === "boolean" ? data.waterLevel : null;
    rows.push({
        label: "Water Level",
        value: formatWaterLevelText(level),
        state: level == null ? "No data" : level ? "In range" : "Out of range",
        tone: level == null ? "none" : level ? "ok" : "bad"
    });
    return rows;
}

function rowEl({ label, value, state, tone }) {
    const li = document.createElement("li");
    li.className = "wc-row";
    for (const [cls, text] of [["wc-name", label], ["wc-val", value], [`wc-state wc-state--${tone}`, state]]) {
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text;
        li.appendChild(span);
    }
    return li;
}

/** Paints the panel; data is the normalized live doc (or null), freshness is { state, updatedText } from the hardware monitor. */
export function renderWaterCondition(data, freshness) {
    const card = document.getElementById("waterConditionCard");
    if (!card) return;
    const donut = document.getElementById("wcDonut");
    const pctEl = document.getElementById("wcPct");
    const statusEl = document.getElementById("wcStatus");
    const freshEl = document.getElementById("wcFresh");

    const score = data ? calcWaterQualityScore(data) : null;
    const pct = score == null ? null : Math.round(score * 100);
    const dim = freshness?.state !== "online";
    const status = pct == null ? null : scoreStatus(pct);
    // Old data never gets the OPTIMAL/GOOD colour or word; it is greyed and labelled Stale/Offline.
    const color = dim || !status ? "#9ca3af" : status.color;

    card.classList.toggle("wc--dim", dim);
    pctEl.textContent = pct == null ? "--" : pct + "%";
    donut.style.background = pct == null ? "#e5e7eb" : `conic-gradient(${color} 0deg ${(pct * 3.6).toFixed(1)}deg, #e5e7eb ${(pct * 3.6).toFixed(1)}deg 360deg)`;
    statusEl.textContent = !data ? "No live data" : dim ? (DIM_LABEL[freshness?.state] || "Offline") : status ? status.label : "No data";
    statusEl.style.color = dim || !status ? "" : status.color;
    freshEl.textContent = !data ? (freshness?.updatedText || "Waiting for live data")
        : dim ? `Last known reading · ${freshness?.updatedText || "Last updated —"}` : (freshness?.updatedText || "");
    document.getElementById("wcRows").replaceChildren(...breakdownRows(data).map(rowEl));
}
