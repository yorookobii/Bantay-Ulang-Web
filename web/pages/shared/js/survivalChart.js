import { db } from "./firebase.js";
import {
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// Same per-doc weekNumber bucketing as mortalityChart.js (matches the Flutter
// app's logs.dart _weekNumberFor) — deaths summed per week, not recomputed.
async function loadDeathsByWeek(cycleStart) {
    const q = query(
        collection(db, "mortality_records"),
        where("createdAt", ">=", Timestamp.fromDate(cycleStart)),
        orderBy("createdAt", "asc")
    );
    const snap = await getDocs(q);

    const deathsByWeek = {};
    snap.docs.forEach(docSnap => {
        const d = docSnap.data();
        const week = Number(d.weekNumber);
        if (!Number.isFinite(week) || week < 1) return;
        deathsByWeek[week] = (deathsByWeek[week] || 0) + (Number(d.deathCount) || 0);
    });
    return deathsByWeek;
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
    }

    // A failed fetch is not the same as a legitimate zero-deaths cycle — we
    // genuinely don't know survival if the query itself failed, so only a
    // successful fetch (even one that returns no records) renders the line.
    if (deathsByWeek === null) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const currentWeek = Math.max(1, Math.floor((Date.now() - cycle.cycleStart.getTime()) / MS_PER_WEEK) + 1);

    const labels = [];
    const data = [];
    let cumulativeDeaths = 0;
    for (let w = 1; w <= currentWeek; w++) {
        cumulativeDeaths += deathsByWeek[w] || 0;
        const survivalPct = Math.max(0, ((cycle.initialStock - cumulativeDeaths) / cycle.initialStock) * 100);
        labels.push("Week " + w);
        data.push(Math.round(survivalPct * 10) / 10);
    }

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
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    min: 70,
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
