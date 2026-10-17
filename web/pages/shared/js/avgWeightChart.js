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
import { median } from "./reportCleanup.js";
import { HARVEST_WEEK } from "./survivalTrend.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function toDateValue(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
}

// Cycle start plus the RF weight projection (predict_yield.py rfProjection*) from the same single read.
async function loadCycle() {
    const snap = await getDocs(
        query(collection(db, "growth_indicators"), orderBy("timestamp", "desc"), limit(1))
    );
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    const points = Array.isArray(d.rfProjectionByWeek)
        ? d.rfProjectionByWeek.filter(p => Number.isInteger(p?.week) && Number.isFinite(p?.weightG))
        : [];
    const projection = points.length ? {
        points,
        early: d.rfProjectionEarly === true,
        source: d.rfProjectionStart?.source ?? null,
        note: d.rfProjectionNote || "",
        updatedAt: toDateValue(d.rfProjectionUpdatedAt)
    } : null;
    return { cycleStart: toDateValue(d.cycleStart), projection };
}

// ulang_growth_records has no precomputed weekNumber (unlike mortality_records) —
// derive it from createdAt the same way Flutter's _weekNumberFor does:
// week 1 = [cycleStart, cycleStart+7d), etc.
// One entry per prawn sample: { weightG, week, createdAtMs, observedAtMs }, oldest first.
// Optional until (exclusive) and max bound the read; existing callers pass neither.
export async function loadWeightSamples(cycleStart, { until = null, max = null } = {}) {
    const q = query(
        collection(db, "ulang_growth_records"),
        where("createdAt", ">=", Timestamp.fromDate(cycleStart)),
        ...(until ? [where("createdAt", "<", Timestamp.fromDate(until))] : []),
        orderBy("createdAt", "asc"),
        ...(max ? [limit(max)] : [])
    );
    const snap = await getDocs(q);

    const samples = [];
    snap.docs.forEach(docSnap => {
        const d = docSnap.data();
        const createdAt = toDateValue(d.createdAt);
        const weight = Number(d.weight);
        if (!createdAt || !Number.isFinite(weight)) return;

        const week = Math.floor((createdAt.getTime() - cycleStart.getTime()) / MS_PER_WEEK) + 1;
        if (week < 1) return;

        samples.push({
            weightG: weight,
            week,
            createdAtMs: createdAt.getTime(),
            observedAtMs: toDateValue(d.observedAt)?.getTime() ?? null
        });
    });
    return samples;
}

// { week: { sum, count } } — averaged per week by callers, never summed raw.
export function bucketWeightsByWeek(samples) {
    const byWeek = {};
    samples.forEach(({ weightG, week }) => {
        if (!byWeek[week]) byWeek[week] = { sum: 0, count: 0 };
        byWeek[week].sum   += weightG;
        byWeek[week].count += 1;
    });
    return byWeek;
}

export async function loadWeightsByWeek(cycleStart) {
    return bucketWeightsByWeek(await loadWeightSamples(cycleStart));
}

// { week: { median, n } } from raw samples.
function weeklyMedians(samples) {
    const byWeek = {};
    samples.forEach(({ weightG, week }) => {
        if (!byWeek[week]) byWeek[week] = [];
        byWeek[week].push(weightG);
    });
    return Object.fromEntries(Object.entries(byWeek).map(([w, v]) => [w, { median: median(v), n: v.length }]));
}

function fmtDate(d) {
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function showEmpty(canvas, emptyEl) {
    if (canvas)  canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "";
}

export async function initAvgWeightChart() {
    const canvas  = document.getElementById("avgWeightChart");
    const emptyEl = document.getElementById("avgWeightEmptyState");
    if (!canvas) return;

    let cycle = null;
    try {
        cycle = await loadCycle();
    } catch (err) {
        console.warn("avgWeightChart: could not load growth_indicators:", err);
    }

    if (!cycle?.cycleStart) {
        showEmpty(canvas, emptyEl);
        return;
    }
    const { cycleStart, projection } = cycle;

    let byWeek = null;
    try {
        byWeek = weeklyMedians(await loadWeightSamples(cycleStart));
    } catch (err) {
        console.warn("avgWeightChart: could not load ulang_growth_records:", err);
    }

    if (byWeek === null || (Object.keys(byWeek).length === 0 && !projection)) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const currentWeek = Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / MS_PER_WEEK) + 1);
    const projByWeek = Object.fromEntries((projection?.points ?? []).map(p => [p.week, Math.round(p.weightG * 10) / 10]));
    const anchorWeek = projection ? Math.min(...projection.points.map(p => p.week)) : null;
    // Week 0 is the stocking day, shown only when a projection can anchor there.
    const firstWeek = projection ? 0 : 1;
    const maxWeek = Math.max(currentWeek, ...Object.keys(byWeek).map(Number), ...(projection ? [HARVEST_WEEK, ...Object.keys(projByWeek).map(Number)] : []));

    const labels = [];
    const data = [];
    const counts = [];
    const projData = [];
    for (let w = firstWeek; w <= maxWeek; w++) {
        labels.push("Week " + w);
        const bucket = byWeek[w];
        // Weekly MEDIAN, robust to a mis-keyed sample; no records this week is null (a gap), never 0 g.
        data.push(bucket ? Math.round(bucket.median * 10) / 10 : null);
        counts.push(bucket ? bucket.n : 0);
        projData.push(projByWeek[w] ?? null);
    }

    const subtitleEl = document.getElementById("avgWeightSubtitle");
    if (subtitleEl && projection) {
        subtitleEl.textContent = (projection.early
            ? "Median weight per prawn each week; dashed line is an early RF projection (before day 90)."
            : "Median weight per prawn each week; dashed line is the RF projection to harvest.")
            + (projection.note ? " " + projection.note : "");
    }

    new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Median weight (g)",
                data,
                borderColor: "#0d9488",
                backgroundColor: "rgba(13, 148, 136, 0.1)",
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: "#0d9488",
                pointRadius: 4,
                spanGaps: false
            }, ...(projection ? [{
                label: projection.early ? "Projected (RF), early projection" : "Projected (RF)",
                data: projData,
                borderColor: "#0d9488",
                borderDash: [6, 4],
                borderWidth: 2,
                fill: false,
                tension: 0.3,
                pointBackgroundColor: "#ffffff",
                pointRadius: ctx => ctx.dataIndex === anchorWeek - firstWeek ? 4 : 0,
                pointHitRadius: 6,
                spanGaps: true
            }] : [])]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: !!projection },
                tooltip: {
                    filter: item => item.raw != null,
                    callbacks: {
                        label: item => {
                            if (item.datasetIndex === 0) return `Median: ${item.raw} g (n = ${counts[item.dataIndex]})`;
                            if (item.dataIndex === anchorWeek - firstWeek) {
                                return `Model start: ${item.raw} g (${projection.source === "real" ? "median of week " + anchorWeek : "stocking weight"})`;
                            }
                            return `${item.dataset.label}: ${item.raw} g`;
                        },
                        footer: items => items.some(i => i.datasetIndex === 1) && projection.updatedAt
                            ? "Model run: " + fmtDate(projection.updatedAt) : ""
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "Weight (g)" },
                    grid: { color: "#f3f4f6" }
                },
                x: { grid: { display: false } }
            }
        }
    });
}
