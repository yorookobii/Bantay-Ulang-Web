import { db, auth } from "./firebase.js";
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const COLL = "feeding_records";

let currentUid = null;

onAuthStateChanged(auth, (user) => {
    currentUid = user ? user.uid : null;
});

// ── Render ────────────────────────────────────────────────────────────────────

function fmtTimestamp(ts) {
    if (!ts) return "—";
    const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-PH", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

function renderRows(docs) {
    const tbody = document.getElementById("frTbody");
    if (!tbody) return;

    if (docs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="fr-empty">No feeding records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = docs.map((snap) => {
        const d = snap.data();
        return `
        <tr>
            <td data-label="Feed Type">${escHtml(d.feedType ?? "—")}</td>
            <td data-label="Amount (g)">${d.amount != null ? Number(d.amount).toLocaleString() + " g" : "—"}</td>
            <td data-label="Feeding Time">${fmtTimestamp(d.feedingTime)}</td>
            <td data-label="Notes" class="notes-cell" title="${escHtml(d.notes ?? "")}">${escHtml(d.notes ?? "—")}</td>
            <td data-label="Created At">${fmtTimestamp(d.createdAt)}</td>
            <td data-label="Action">
                <button class="fr-btn-icon delete-btn" data-id="${snap.id}" title="Delete record">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`;
    }).join("");
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Real-time listener ────────────────────────────────────────────────────────

function subscribeRecords() {
    const loading = document.getElementById("frLoading");
    const q = query(collection(db, COLL), orderBy("createdAt", "desc"));

    return onSnapshot(q, (snapshot) => {
        if (loading) loading.style.display = "none";
        renderRows(snapshot.docs);
    }, (err) => {
        if (loading) loading.style.display = "none";
        console.error("feeding_records listener error:", err);
        const tbody = document.getElementById("frTbody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="fr-empty" style="color:#dc2626">Failed to load records.</td></tr>`;
    });
}

// ── Add record ────────────────────────────────────────────────────────────────

async function addFeedingRecord(feedType, amount, feedingTime, notes) {
    const data = {
        feedType,
        amount,
        feedingTime: feedingTime
            ? Timestamp.fromDate(new Date(feedingTime))
            : serverTimestamp(),
        notes,
        createdBy: currentUid ?? "unknown",
        createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, COLL), data);
}

// ── Delete record ─────────────────────────────────────────────────────────────

async function deleteFeedingRecord(id) {
    await deleteDoc(doc(db, COLL, id));
}

// ── Form handling ─────────────────────────────────────────────────────────────

function showFeedback(msg, type) {
    const el = document.getElementById("frFeedback");
    if (!el) return;
    el.textContent = msg;
    el.className = `fr-feedback ${type}`;
    setTimeout(() => { el.className = "fr-feedback"; }, 4000);
}

function initForm() {
    const form = document.getElementById("frForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const feedType   = form.feedType.value.trim();
        const amount     = parseFloat(form.amount.value);
        const feedingTime = form.feedingTime.value;
        const notes      = form.notes.value.trim();

        // Basic validation
        let valid = true;
        if (!feedType)       { form.feedType.classList.add("invalid"); valid = false; }
        else                 { form.feedType.classList.remove("invalid"); }
        if (isNaN(amount) || amount < 0) { form.amount.classList.add("invalid"); valid = false; }
        else                 { form.amount.classList.remove("invalid"); }
        if (!valid) return;

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

        try {
            await addFeedingRecord(feedType, amount, feedingTime, notes);
            showFeedback("Feeding record added successfully.", "success");
            form.reset();
        } catch (err) {
            console.error("Error adding feeding record:", err);
            showFeedback("Failed to add record. Please try again.", "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-plus"></i> Add Record`;
        }
    });
}

function initDeleteDelegation() {
    const tbody = document.getElementById("frTbody");
    if (!tbody) return;

    tbody.addEventListener("click", async (e) => {
        const btn = e.target.closest(".delete-btn");
        if (!btn) return;

        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm("Delete this feeding record? This cannot be undone.")) return;

        btn.disabled = true;
        try {
            await deleteFeedingRecord(id);
        } catch (err) {
            console.error("Error deleting feeding record:", err);
            alert("Failed to delete record. Please try again.");
            btn.disabled = false;
        }
    });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    initForm();
    initDeleteDelegation();
    subscribeRecords();
});
