import { db } from "./firebase.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadDeathsByWeek } from "./mortalityChart.js";
import { HARVEST_WEEK, projectSurvival } from "./survivalTrend.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function toDateValue(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
}

async function loadCycle() {
    const snap = await getDocs(
        query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
    );
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    const cycleStart   = toDateValue(d.cycleStart);
    const initialStock = Number(d.initialStock);
    if (!cycleStart || !Number.isFinite(initialStock) || initialStock <= 0) return null;
    return { cycleStart, initialStock };
}

function showEmpty(canvas, emptyEl) {
    if (canvas)  canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
}

export async function initSurvivalChart() {
    const canvas  = document.getElementById("survivalChart");
    const emptyEl = document.getElementById("survivalEmptyState");
    if (!canvas) return;

    let cycle = null;
    try {
        cycle = await loadCycle();
    } catch (err) {
        console.warn("survivalChart: could not load growth_indicators:", err);
    }

    if (!cycle) {
        showEmpty(canvas, emptyEl);
        return;
    }

    let deathsByWeek = null;
    try {
        deathsByWeek = await loadDeathsByWeek(cycle.cycleStart);
    } catch (err) {
        console.warn("survivalChart: could not load mortality_records:", err);
        if (emptyEl) emptyEl.textContent = "Couldn't load mortality records.";
    }

    // A failed fetch is not the same as a legitimate zero-deaths cycle — we
    // genuinely don't know survival if the query itself failed, so only a
    // successful fetch (even one that returns no records) renders the line.
    if (deathsByWeek === null) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const currentWeek = Math.max(1, Math.floor((Date.now() - cycle.cycleStart.getTime()) / MS_PER_WEEK) + 1);

    const trend = projectSurvival(deathsByWeek, cycle.initialStock, currentWeek);
    const trendByWeek = Object.fromEntries((trend?.points ?? []).map(p => [p.week, Math.round(p.pct * 10) / 10]));
    const lastWeek = trend ? Math.max(currentWeek, HARVEST_WEEK) : currentWeek;

    const labels = [];
    const data = [];
    const trendData = [];
    let cumulativeDeaths = 0;
    for (let w = 1; w <= lastWeek; w++) {
        labels.push("Week " + w);
        trendData.push(trendByWeek[w] ?? null);
        if (w > currentWeek) { data.push(null); continue; }
        cumulativeDeaths += deathsByWeek[w] || 0;
        const survivalPct = Math.max(0, ((cycle.initialStock - cumulativeDeaths) / cycle.initialStock) * 100);
        data.push(Math.round(survivalPct * 10) / 10);
    }

    const subtitleEl = document.getElementById("survivalSubtitle");
    if (subtitleEl && cumulativeDeaths === 0) subtitleEl.textContent = "No deaths logged yet this cycle (100% assumes every death is logged).";
    else if (subtitleEl && trend) subtitleEl.textContent = `Actual survival from logged mortality; dashed line assumes the ${(trend.weeklyRate * 100).toFixed(2)}% average weekly death rate of ${trend.completedWeeks} completed weeks continues to week ${HARVEST_WEEK}.`;
    // Floor follows the lowest point, rounded down to the 10% tick, so survival under 70% is never clipped.
    const plotted = [...data, ...trendData].filter(v => v != null);
    const yMin = Math.max(0, Math.min(70, Math.floor((Math.min(...plotted) - 5) / 10) * 10));

    new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Survival Rate (%)",
                    data,
                    borderColor: "#059669",
                    backgroundColor: "rgba(5, 150, 105, 0.1)",
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointBackgroundColor: "#059669",
                    pointRadius: 3
                },
                ...(trend ? [{
                    label: "Trend if current death rate continues (%)",
                    data: trendData,
                    borderColor: "#059669",
                    borderDash: [6, 4],
                    borderWidth: 2,
                    fill: false,
                    tension: 0,
                    pointRadius: 0,
                    pointHitRadius: 6,
                    spanGaps: true
                }] : [])
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: !!trend },
                tooltip: { filter: item => item.raw != null }
            },
            scales: {
                y: {
                    min: yMin,
                    max: 100,
                    ticks: { stepSize: 10 },
                    grid: { color: "#f3f4f6" }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}
