import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { AQUAPONICS_REF } from "./aquaponicsReading.js";

// Actuator Activity panel: controller activation counters from the live doc, one getDoc per open, textContent only (doc is device-writable).

// Fixed list so labels are always ours; doc keys are never iterated.
const COUNTERS = [
    { path: "automaticStatus.phUpPump.activationCount",       label: "pH Up Pump" },
    { path: "automaticStatus.phDownPump.activationCount",     label: "pH Down Pump" },
    { path: "automaticStatus.aerator.activationCount",        label: "Aerator" },
    { path: "automaticStatus.automaticWater.activationCount", label: "Automatic Water" },
    { path: "automaticStatus.salinityPump.activationCount",   label: "Salinity Pump" },
    { path: "automaticFeeder.activationCount",                label: "Feeder" }
];

const valueAt = (data, path) => path.split(".").reduce((obj, key) => obj?.[key], data);
const countText = (v) => (Number.isInteger(v) && v >= 0 ? v.toLocaleString("en-US") : "—");

function freshnessText(measuredAt) {
    const ms = measuredAt && typeof measuredAt.toMillis === "function" ? measuredAt.toMillis() : null;
    return ms == null ? "Time unknown" : "As of " + new Date(ms).toLocaleString("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
}

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
}

function buildCards(data) {
    const grid = el("div", "aa-grid");
    for (const { path, label } of COUNTERS) {
        const card = el("div", "aa-card");
        card.append(el("span", "aa-value", countText(valueAt(data, path))), el("span", "aa-label", label));
        grid.appendChild(card);
    }
    return grid;
}

/** Wires the panel; the live doc is read only on first open and on Refresh. */
export function initActuatorActivity({ panel, body, refreshBtn }) {
    let loaded = false;

    async function load() {
        refreshBtn.disabled = true;
        const spinner = el("div", "fr-loading");
        spinner.append(el("i", "fa-solid fa-spinner fa-spin"), "Loading counters…");
        body.replaceChildren(spinner);
        try {
            const data = (await getDoc(AQUAPONICS_REF)).data() ?? {};
            body.replaceChildren(buildCards(data), el("p", "aa-meta", freshnessText(data.measuredAt)));
        } catch (err) {
            console.error("Actuator activity load error:", err);
            body.replaceChildren(el("p", "fr-empty al-error", "Failed to load controller counters."));
        } finally {
            refreshBtn.disabled = false;
        }
    }

    panel.addEventListener("toggle", () => {
        if (!panel.open || loaded) return;
        loaded = true;
        load();
    });
    refreshBtn.addEventListener("click", load);
}
