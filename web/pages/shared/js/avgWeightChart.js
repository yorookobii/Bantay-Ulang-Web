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
import { median, bucketWeightsByWeek } from "./reportCleanup.js";
import { HARVEST_WEEK } from "./survivalTrend.js";
import { pondTrend, MIN_TREND_WEEKS } from "./pondTrend.js";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function toDateValue(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
}

// Cycle start, stocking weight and the RF weight projection (predict_yield.py rfProjection*) from the same single read.
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
    return { cycleStart: toDateValue(d.cycleStart), projection, stockingWeight: Number(d.stockingWeight) };
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

// Note under the chart: the weeks the trend was fitted on and where it ends; early wording at exactly MIN_TREND_WEEKS weeks.
export function pondTrendNote(trend) {
    const end = trend.points[trend.points.length - 1];
    const fitted = `stocking + week ${trend.weeks.join(", ")}`;
    const expected = `expected ${Math.round(end.weightG * 10) / 10} g by week ${end.week}.`;
    return trend.weeks.length === MIN_TREND_WEEKS
        ? `Pond trend (early estimate, ${MIN_TREND_WEEKS} weigh-ins: ${fitted}): ${expected}`
        : `Pond trend from ${trend.weeks.length} weigh-ins (${fitted}): ${expected}`;
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
    const { cycleStart, projection, stockingWeight } = cycle;

    let samples = null;
    try {
        samples = await loadWeightSamples(cycleStart);
    } catch (err) {
        console.warn("avgWeightChart: could not load ulang_growth_records:", err);
    }
    const byWeek = samples === null ? null : weeklyMedians(samples);

    if (byWeek === null || (Object.keys(byWeek).length === 0 && !projection)) {
        showEmpty(canvas, emptyEl);
        return;
    }

    const trend = pondTrend(samples, cycleStart.getTime(), stockingWeight);
    const currentWeek = Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / MS_PER_WEEK) + 1);
    const round1 = v => Math.round(v * 10) / 10;
    const projByWeek = Object.fromEntries((projection?.points ?? []).map(p => [p.week, round1(p.weightG)]));
    const trendByWeek = Object.fromEntries((trend?.points ?? []).map(p => [p.week, round1(p.weightG)]));
    const anchorWeek = projection ? Math.min(...projection.points.map(p => p.week)) : null;
    // Week 0 is the stocking day, shown only when a projection can anchor there; the pond trend only extends the end.
    const firstWeek = projection ? 0 : 1;
    const maxWeek = Math.max(currentWeek, ...Object.keys(byWeek).map(Number),
        ...(projection ? [HARVEST_WEEK, ...Object.keys(projByWeek).map(Number)] : []), ...Object.keys(trendByWeek).map(Number));

    const labels = [];
    const data = [];
    const counts = [];
    const projData = [];
    const trendData = [];
    for (let w = firstWeek; w <= maxWeek; w++) {
        labels.push("Week " + w);
        const bucket = byWeek[w];
        // Weekly MEDIAN, robust to a mis-keyed sample; no records this week is null (a gap), never 0 g.
        data.push(bucket ? round1(bucket.median) : null);
        counts.push(bucket ? bucket.n : 0);
        projData.push(projByWeek[w] ?? null);
        trendData.push(trendByWeek[w] ?? null);
    }

    const trendNoteEl = document.getElementById("pondTrendNote");
    if (trendNoteEl) {
        trendNoteEl.hidden = !trend;
        if (trend) trendNoteEl.textContent = pondTrendNote(trend);
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
                kind: "actual",
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
                kind: "projected",
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
            }] : []), ...(trend ? [{
                kind: "pondTrend",
                label: "Expected (pond trend)",
                data: trendData,
                borderColor: "#d97706",
                borderDash: [2, 4],
                borderWidth: 2,
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHitRadius: 6,
                spanGaps: true
            }] : [])]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: !!(projection || trend) },
                tooltip: {
                    // The trend's first point is the latest median itself, already shown as "Median".
                    filter: item => item.raw != null
                        && !(item.dataset.kind === "pondTrend" && item.dataIndex === trend.latestWeek - firstWeek),
                    callbacks: {
                        label: item => {
                            const kind = item.dataset.kind;
                            if (kind === "actual") return `Median: ${item.raw} g (n = ${counts[item.dataIndex]})`;
                            if (kind === "pondTrend") return `Pond trend: ${item.raw} g`;
                            if (item.dataIndex === anchorWeek - firstWeek) {
                                return `Model start: ${item.raw} g (${projection.source === "real" ? "median of week " + anchorWeek : "stocking weight"})`;
                            }
                            return `${item.dataset.label}: ${item.raw} g`;
                        },
                        footer: items => items.some(i => i.dataset.kind === "projected") && projection.updatedAt
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
