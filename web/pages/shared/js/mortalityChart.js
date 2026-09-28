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

async function loadCycleStart() {
    const snap = await getDocs(
        query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
    );
    if (snap.empty) return null;
    return toDateValue(snap.docs[0].data().cycleStart);
}

// Every mortality_records doc since cycleStart as { week, deaths, createdAtMs }; week may be NaN or < 1 when not recorded.
export async function loadMortalityRecords(cycleStart) {
    const q = query(
        collection(db, "mortality_records"),
        where("createdAt", ">=", Timestamp.fromDate(cycleStart)),
        orderBy("createdAt", "asc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(docSnap => {
        const d = docSnap.data();
        return {
            week: Number(d.weekNumber),
            deaths: Number(d.deathCount) || 0,
            createdAtMs: toDateValue(d.createdAt)?.getTime() ?? null
        };
    });
}

// weekNumber matches the Flutter app's own bucketing (logs.dart _weekNumberFor):
// week 1 = [cycleStart, cycleStart+7d), etc. mortality_records already stores
// this per-doc, so we just sum deathCount per weekNumber rather than recompute it.
// Records without a valid weekNumber go to `unrecorded` instead of a week.
export function bucketDeathsByWeek(records) {
    const byWeek = {};
    let unrecorded = 0;
    records.forEach(({ week, deaths }) => {
        if (!Number.isFinite(week) || week < 1) { unrecorded += deaths; return; }
        byWeek[week] = (byWeek[week] || 0) + deaths;
    });
    return { byWeek, unrecorded };
}

// Charts only plot valid weeks, so this keeps its original { week: deaths } shape.
export async function loadDeathsByWeek(cycleStart) {
    return bucketDeathsByWeek(await loadMortalityRecords(cycleStart)).byWeek;
}

function showEmpty(canvas, emptyEl) {
    if (canvas)  canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
}

export async function initMortalityChart() {
    const canvas  = document.getElementById("mortalityRateChart");
    const emptyEl = document.getElementById("mortalityEmptyState");
    if (!canvas) return;

    let cycleStart = null;
    try {
        cycleStart = await loadCycleStart();
    } catch (err) {
        console.warn("mortalityChart: could not load growth_indicators:", err);
    }

    if (!cycleStart) {
        showEmpty(canvas, emptyEl);
        return;
    }

    let deathsByWeek = {};
    try {
        deathsByWeek = await loadDeathsByWeek(cycleStart);
    } catch (err) {
        console.warn("mortalityChart: could not load mortality_records:", err);
        showEmpty(canvas, emptyEl);
        return;
    }

    if (Object.keys(deathsByWeek).length === 0) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const currentWeek = Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / MS_PER_WEEK) + 1);
    const maxWeek = Math.max(currentWeek, ...Object.keys(deathsByWeek).map(Number));

    const labels = [];
    const data = [];
    for (let w = 1; w <= maxWeek; w++) {
        labels.push("Week " + w);
        data.push(deathsByWeek[w] || 0);
    }

    new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Deaths",
                data,
                backgroundColor: "#dc2626",
                borderRadius: 4,
                maxBarThickness: 28
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 },
                    title: { display: true, text: "Deaths" },
                    grid: { color: "#f3f4f6" }
                },
                x: { grid: { display: false } }
            }
        }
    });
}
