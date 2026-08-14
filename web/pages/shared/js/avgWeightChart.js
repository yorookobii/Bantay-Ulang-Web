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

// ulang_growth_records has no precomputed weekNumber (unlike mortality_records) —
// derive it from createdAt the same way Flutter's _weekNumberFor does:
// week 1 = [cycleStart, cycleStart+7d), etc.
async function loadWeightsByWeek(cycleStart) {
    const q = query(
        collection(db, "ulang_growth_records"),
        where("createdAt", ">=", Timestamp.fromDate(cycleStart)),
        orderBy("createdAt", "asc")
    );
    const snap = await getDocs(q);

    // { week: { sum, count } } — averaged per week below, never summed raw.
    const byWeek = {};
    snap.docs.forEach(docSnap => {
        const d = docSnap.data();
        const createdAt = toDateValue(d.createdAt);
        const weight = Number(d.weight);
        if (!createdAt || !Number.isFinite(weight)) return;

        const week = Math.floor((createdAt.getTime() - cycleStart.getTime()) / MS_PER_WEEK) + 1;
        if (week < 1) return;

        if (!byWeek[week]) byWeek[week] = { sum: 0, count: 0 };
        byWeek[week].sum   += weight;
        byWeek[week].count += 1;
    });
    return byWeek;
}

function showEmpty(canvas, emptyEl) {
    if (canvas)  canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
}

export async function initAvgWeightChart() {
    const canvas  = document.getElementById("avgWeightChart");
    const emptyEl = document.getElementById("avgWeightEmptyState");
    if (!canvas) return;

    let cycleStart = null;
    try {
        cycleStart = await loadCycleStart();
    } catch (err) {
        console.warn("avgWeightChart: could not load growth_indicators:", err);
    }

    if (!cycleStart) {
        showEmpty(canvas, emptyEl);
        return;
    }

    let byWeek = null;
    try {
        byWeek = await loadWeightsByWeek(cycleStart);
    } catch (err) {
        console.warn("avgWeightChart: could not load ulang_growth_records:", err);
    }

    if (byWeek === null || Object.keys(byWeek).length === 0) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const currentWeek = Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / MS_PER_WEEK) + 1);
    const maxWeek = Math.max(currentWeek, ...Object.keys(byWeek).map(Number));

    const labels = [];
    const data = [];
    for (let w = 1; w <= maxWeek; w++) {
        labels.push("Week " + w);
        const bucket = byWeek[w];
        // AVERAGE (sum ÷ count), not sum — a raw sum across records in the
        // week is what produced the impossible 23120g figure in the Flutter
        // app's getWeeklyWeightData bug. No records this week → null (gap in
        // the line), never 0 — 0g would misreport "no data" as "no weight."
        data.push(bucket && bucket.count > 0 ? Math.round((bucket.sum / bucket.count) * 10) / 10 : null);
    }

    new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Avg Weight (g)",
                data,
                borderColor: "#0d9488",
                backgroundColor: "rgba(13, 148, 136, 0.1)",
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: "#0d9488",
                pointRadius: 4,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Avg Weight (g)" },
                    grid: { color: "#f3f4f6" }
                },
                x: { grid: { display: false } }
            }
        }
    });
}
