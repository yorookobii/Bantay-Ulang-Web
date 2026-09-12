import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadThresholds } from "./thresholds.js";
import { initSidebar } from "./sidebar.js";
import { initEnvTrendsChart, refreshEnvTrendsChart } from "./envTrendsChart.js";

// ── growth_indicators cycleStart (one-shot, mirrors dashboard.js) ──────────

function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function loadCycleStartMs() {
    try {
        const snap = await getDocs(query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1)));
        if (snap.empty) return null;

        const cycleStart = toDateValue(snap.docs[0].data().cycleStart);
        return cycleStart ? cycleStart.getTime() : null;
    } catch (err) {
        console.warn("environmental-trends: unable to load growth_indicators for cycleStart:", err);
        return null;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    initSidebar();

    const canvas = document.getElementById("envTrendsChart");
    const loadingEl = document.getElementById("envTrendsLoading");
    const paramDropdown = document.getElementById("envTrendsParamDropdown");
    const rangeDropdown = document.getElementById("envTrendsRangeDropdown");
    if (!canvas) return;

    const chart = initEnvTrendsChart(canvas);

    let cycleStartMs = null;
    try {
        const loaded = await Promise.all([loadCycleStartMs(), loadThresholds()]);
        cycleStartMs = loaded[0];
    } catch (err) {
        console.warn("environmental-trends: init (cycleStart/thresholds) failed:", err);
    }

    const refresh = () => {
        const paramKey = paramDropdown ? paramDropdown.value : "ph";
        const rangeKey = rangeDropdown ? rangeDropdown.value : "24h";
        return refreshEnvTrendsChart(chart, paramKey, rangeKey, cycleStartMs);
    };

    if (paramDropdown) paramDropdown.addEventListener("change", refresh);
    if (rangeDropdown) rangeDropdown.addEventListener("change", refresh);

    // Only the very first load can hit the cold-cache catch-up path
    // (catchUpCache inside refreshEnvTrendsChart) — show the overlay for
    // that call only, not on every later dropdown change.
    if (loadingEl) loadingEl.classList.remove("chart-hidden");
    await refresh();
    if (loadingEl) loadingEl.classList.add("chart-hidden");
});
