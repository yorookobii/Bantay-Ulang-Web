import {
    gatherReport,
    estimateNewReads,
    checkReadBudget,
    rangeForPreset,
    validateCustomRange,
    loadCycleInfo,
    MAX_UNCACHED_DAYS,
    SECTIONS
} from "./reportData.js";
import { buildReportFiles, downloadFiles } from "./reportCsv.js";

// Generate Report modal on the admin dashboard: range + sections -> CSV downloads.

const SECTION_LABELS = {
    waterQuality:    "Water quality readings",
    alerts:          "Alerts",
    mortalityGrowth: "Mortality and growth",
    yield:           "Yield prediction",
    tasks:           "Tasks",
    logs:            "Activity logs"
};

const STAGE_TEXT = {
    waterQuality:    "Checking saved readings…",
    alerts:          "Loading alerts…",
    mortalityGrowth: "Loading mortality and growth…",
    yield:           "Loading yield prediction…",
    tasks:           "Loading tasks…",
    logs:            "Loading activity logs…"
};

let els = null;
let cycleStartMs = null;
let busy = false;
let runId = 0;          // bumped on cancel/close so a late result is ignored
let estimateToken = 0;  // drops out-of-order estimate results

// Plain-language text for a failure; read-budget errors already carry their own message.
function errorMessage(err) {
    const code = err?.code || "";
    if (code === "read-budget") return err.message;
    if (code === "permission-denied") return "Your account doesn't have permission to read this data. Sign out, sign back in with an admin account, and try again.";
    if (code === "resource-exhausted") return "The farm database's read allowance for today has been used up. Try again tomorrow.";
    if (code === "unavailable" || code === "deadline-exceeded" || !navigator.onLine || /network|failed to fetch/i.test(err?.message || "")) {
        return "Couldn't reach the server. Check the internet connection and try again.";
    }
    return "Something went wrong while building the report" + (code ? ` (${code})` : "") + ". Please try again.";
}

function budgetText(newReads) {
    return `This range needs about ${newReads.toLocaleString("en-PH")} sensor readings that aren't saved in this browser yet. ` +
        `The farm database only allows a limited number of reads per day, so one report can download at most ${MAX_UNCACHED_DAYS} days of readings. ` +
        `Choose a shorter range.`;
}

const pad = (n) => String(n).padStart(2, "0");
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function selectedSections() {
    return SECTIONS.filter(key => els.form.querySelector(`input[name="reportSection"][value="${key}"]`)?.checked);
}

// Resolves the chosen range to { range } or { error }; presets use the current time.
function currentRange() {
    const preset = els.form.querySelector('input[name="reportRange"]:checked')?.value;
    if (preset !== "custom") {
        const range = rangeForPreset(preset, cycleStartMs);
        return range ? { range } : { error: "No cycle start date is set in Settings, so \"This cycle\" isn't available." };
    }
    const sinceMs = els.from.value ? new Date(els.from.value + "T00:00:00").getTime() : NaN;
    const untilMs = els.to.value ? new Date(els.to.value + "T23:59:59.999").getTime() : NaN;
    const error = validateCustomRange(sinceMs, untilMs);
    return error ? { error } : { range: { sinceMs, untilMs } };
}

function setEstimate(text, blocked) {
    els.estimate.textContent = text;
    els.estimate.classList.toggle("is-blocked", blocked);
    els.generate.disabled = blocked || busy;
}

// Shows what the chosen range will cost before anything is downloaded.
async function refreshEstimate() {
    const token = ++estimateToken;
    const isCustom = els.form.querySelector('input[name="reportRange"]:checked')?.value === "custom";
    els.customRange.hidden = !isCustom;

    const { range, error } = currentRange();
    const sections = selectedSections();
    if (error) return setEstimate(error, true);
    if (!sections.length) return setEstimate("Choose at least one section.", true);
    if (!sections.includes("waterQuality")) return setEstimate("No sensor readings are needed for these sections.", false);

    setEstimate("Checking saved readings…", true);
    try {
        const estimate = await estimateNewReads(cycleStartMs, range.sinceMs, range.untilMs);
        if (token !== estimateToken) return;
        if (!checkReadBudget(estimate).allowed) return setEstimate(budgetText(estimate.newReads), true);
        setEstimate(estimate.newReads === 0
            ? "Uses saved readings (no download)."
            : `Downloads about ${estimate.newReads.toLocaleString("en-PH")} readings.`, false);
    } catch (err) {
        if (token !== estimateToken) return;
        console.warn("[reportModal] Estimate failed:", err);
        setEstimate("Couldn't check saved readings; the download size will be checked when you generate.", false);
    }
}

function setBusy(on) {
    busy = on;
    els.controls.disabled = on;
    els.sections.disabled = on;
    els.generate.disabled = on;
    els.form.setAttribute("aria-busy", String(on));
    els.cancel.textContent = on ? "Cancel" : "Close";
}

function showError(message) {
    els.error.textContent = message;
    els.error.hidden = !message;
}

function renderWarnings(warnings) {
    els.warningList.innerHTML = "";
    warnings.forEach(w => {
        const li = document.createElement("li");
        li.textContent = w.code === "section-failed"
            ? `${SECTION_LABELS[w.section] || w.section} couldn't be loaded: ${errorMessage({ code: w.error })}`
            : w.message;
        els.warningList.appendChild(li);
    });
    els.warnings.hidden = warnings.length === 0;
}

function resetResult() {
    showError("");
    els.status.textContent = "";
    renderWarnings([]);
}

function progressText(p) {
    if (p.stage === "readings") return `Syncing readings… ${p.fetched.toLocaleString("en-PH")}`;
    return STAGE_TEXT[p.stage] || "Working…";
}

async function generate(event) {
    event.preventDefault();
    if (busy) return;
    const { range, error } = currentRange();
    const sections = selectedSections();
    if (error || !sections.length) return showError(error || "Choose at least one section.");

    const run = ++runId;
    const stale = () => run !== runId;
    resetResult();
    setBusy(true);
    try {
        const report = await gatherReport({
            ...range,
            sections,
            onProgress: (p) => { if (!stale()) els.status.textContent = progressText(p); }
        });
        if (stale()) return;

        const failed = report.warnings.filter(w => w.code === "section-failed");
        if (failed.length === sections.length) {
            els.status.textContent = "";
            return showError("No section could be loaded, so nothing was downloaded. " + errorMessage({ code: failed[0].error }));
        }

        renderWarnings(report.warnings);
        const files = buildReportFiles(report);
        els.status.textContent = `Downloading ${files.length} files…`;
        await downloadFiles(files, { shouldStop: stale });
        if (!stale()) els.status.textContent = `Downloaded ${files.length} CSV files. Check your Downloads folder.`;
    } catch (err) {
        if (stale()) return;
        console.error("[reportModal] Report failed:", err);
        els.status.textContent = "";
        showError(errorMessage(err));
    } finally {
        if (!stale()) {
            setBusy(false);
            refreshEstimate();
        }
    }
}

// ─── Open / close / focus ───────────────────────────────────────────────────

function focusableEls() {
    return [...els.modal.querySelectorAll("button, input, select, [tabindex]:not([tabindex='-1'])")]
        .filter(el => !el.disabled && el.offsetParent !== null);
}

function onKeydown(event) {
    if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
    }
    if (event.key !== "Tab") return;
    const items = focusableEls();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

async function openModal() {
    resetResult();
    setBusy(false);
    els.overlay.classList.add("show");
    els.overlay.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeydown);
    els.form.querySelector('input[name="reportRange"]:checked')?.focus();

    els.to.max = els.from.max = toDateInput(new Date());
    setEstimate("Checking saved readings…", true);
    try {
        const growth = await loadCycleInfo();
        cycleStartMs = growth?.cycleStart?.toMillis?.() ?? null;
    } catch (err) {
        console.warn("[reportModal] Could not load cycle info:", err);
        cycleStartMs = null;
        showError(errorMessage(err));
    }
    refreshEstimate();
}

// Closing (or Cancel mid-run) ignores any late result. In-flight Firestore reads can't be aborted, so they still finish and count toward the day's reads.
function closeModal() {
    runId++;
    estimateToken++;
    setBusy(false);
    els.overlay.classList.remove("show");
    els.overlay.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onKeydown);
    els.trigger?.focus();
}

export function initReportModal() {
    const byId = (id) => document.getElementById(id);
    els = {
        trigger: byId("generateReportBtn"),
        overlay: byId("reportModalOverlay"),
        modal: byId("reportModal"),
        form: byId("reportForm"),
        controls: byId("reportControls"),
        sections: byId("reportSections"),
        customRange: byId("reportCustomRange"),
        from: byId("reportFrom"),
        to: byId("reportTo"),
        estimate: byId("reportEstimate"),
        error: byId("reportError"),
        status: byId("reportStatus"),
        warnings: byId("reportWarnings"),
        warningList: byId("reportWarningList"),
        cancel: byId("reportModalCancel"),
        close: byId("reportModalClose"),
        generate: byId("reportGenerate")
    };
    if (!els.trigger || !els.overlay || !els.form) return;

    // Custom range starts as the last 7 calendar days, today included.
    const today = new Date();
    els.to.value = toDateInput(today);
    els.from.value = toDateInput(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));

    els.trigger.addEventListener("click", openModal);
    els.close.addEventListener("click", closeModal);
    els.cancel.addEventListener("click", closeModal);
    els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay) closeModal(); });
    els.form.addEventListener("change", refreshEstimate);
    els.form.addEventListener("submit", generate);
}
