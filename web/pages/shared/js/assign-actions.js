import { db, auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection, query, orderBy, onSnapshot,
    addDoc, deleteDoc, doc, updateDoc, getDoc, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { PARAM_LABELS } from './notificationsShared.js';
import { SUGGESTIONS } from './alertsEngine.js';
import { getRanges, loadThresholds } from './thresholds.js';
import { initSidebar } from './sidebar.js';

// ── Sidebar: hamburger opens drawer, overlay closes it ────────────────────
(function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuBtn = document.getElementById('topbarMenuBtn');
    if (!sidebar || !overlay || !menuBtn) return;
    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
    });
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
    });
})();

// ── Sidebar collapse/toggle, persistence and click-to-collapse ────────────
initSidebar();

// ── Toast notification ────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    let t = document.getElementById('aa-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'aa-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = `aa-toast aa-toast-${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── State ─────────────────────────────────────────────────────────────────
let allUsers       = [];   // { uid, fullName, email, role }[]
let currentUserUid = null;

// Alert context carried in from All Alerts (?alert_id=&param=). Empty when the
// page is opened directly for a manual, alert-less assignment.
const alertCtx = (() => {
    // URL params first — used verbatim when the server keeps the query string.
    const p = new URLSearchParams(location.search);
    let alertId = p.get('alert_id') || '';
    let param   = p.get('param')    || '';

    // Fallback: the sessionStorage handoff from All Alerts, for dev servers whose
    // clean-URL redirect strips the query string.
    if (!alertId) {
        try {
            const stashed = JSON.parse(sessionStorage.getItem('pendingAlertCtx') || 'null');
            if (stashed && stashed.alertId) {
                alertId = stashed.alertId;
                param   = stashed.param || '';
            }
        } catch (_) { /* malformed JSON / storage disabled — ignore */ }
    }

    // Consume the handoff on every load so a later manual visit (or F5) doesn't
    // resurrect a stale banner, and stray new-tab writes get cleaned up.
    try { sessionStorage.removeItem('pendingAlertCtx'); } catch (_) {}

    return { alertId, param };
})();

function alertParamLabel() {
    return PARAM_LABELS[alertCtx.param] || alertCtx.param || 'sensor';
}

// Reveal the context banner on load when an alert was carried in.
(function showAlertContext() {
    if (!alertCtx.alertId) return;
    const banner  = document.getElementById('alertContextBanner');
    const paramEl = document.getElementById('alertContextParam');
    if (!banner || !paramEl) return;
    paramEl.textContent = alertParamLabel();
    banner.hidden = false;
})();

// After a successful assign-with-context: flip the banner to a done state and
// surface the "Back to Alerts" link so the handled state / donut update is visible.
function markAlertContextHandled() {
    const banner = document.getElementById('alertContextBanner');
    const verb   = document.getElementById('alertContextVerb');
    const icon   = document.getElementById('alertContextIcon');
    const back   = document.getElementById('alertContextBack');
    if (banner) banner.classList.add('is-handled');
    if (verb)   verb.textContent = 'Action assigned for';
    if (icon)   icon.className = 'fa-solid fa-circle-check';
    if (back)   back.hidden = false;
}

// ── Pre-fill Notes from the carried-in alert ─────────────────────────────
// Rebuilds the status line (mirrors alertsEngine.js buildMessage) and appends
// the existing per-parameter corrective advice. Notes only — Action type is
// left for the admin to choose. One Firestore read; fully editable result.
async function prefillFromAlert() {
    if (!alertCtx.alertId) return;
    const notesEl = document.getElementById('notes');
    if (!notesEl || notesEl.value.trim() !== '') return;   // never clobber typed text

    let a;
    try {
        const snap = await getDoc(doc(db, 'alerts', alertCtx.alertId));
        if (!snap.exists()) return;
        a = snap.data();
    } catch (err) {
        console.warn('assign-actions: could not load alert for pre-fill:', err);
        return;
    }
    if (notesEl.value.trim() !== '') return;                // admin typed during the fetch

    const param = a.parameter || alertCtx.param || '';
    const value = a.currentValue;

    // Water level is a boolean safe/unsafe flag — no numeric direction to derive,
    // so reuse the alert's own message verbatim instead of asserting high/low.
    if (param === 'waterLevel') {
        if (a.message) notesEl.value = a.message;
        return;
    }

    // Populate the ranges cache from Firestore before reading it, so direction
    // math and the status-line safe range use the admin's configured thresholds
    // rather than defaults (shared one-shot fetch; never rejects — falls back to
    // defaults on error). Mirrors how alertsEngine gets its ranges.
    try { await loadThresholds(); } catch (_) { /* getRanges() falls back to defaults */ }
    if (notesEl.value.trim() !== '') return;   // admin typed during the fetch

    const r = getRanges()[param];
    let direction = null;
    if (r && Number.isFinite(value)) {
        if (r.min != null && value < r.min) direction = 'low';
        else if (r.max != null && value > r.max) direction = 'high';
    }

    const label = (r && r.label) || PARAM_LABELS[param] || param || 'Sensor';
    const unit  = (r && r.unit) || '';
    const safeRangeStr = (r && r.safeRangeStr) || a.safeRange || '';
    const display = Number.isFinite(value)
        ? (Number.isInteger(value) ? value : parseFloat(value.toFixed(2)))
        : value;
    const valueStr = unit ? `${display} ${unit}` : String(display);

    const statusLine = direction
        ? `${label} is ${direction === 'high' ? 'above' : 'below'} the safe range. Current: ${valueStr}. Safe range: ${safeRangeStr}.`
        : `${label} alert. Current: ${valueStr}.`;

    const advice = direction ? ((SUGGESTIONS[param] || {})[direction] || '') : '';

    notesEl.value = [statusLine, advice].filter(Boolean).join('\n\n');
}

// ── Load users from Firestore and populate Person dropdown ────────────────
async function loadUsers() {
    try {
        const snap = await getDocs(collection(db, 'users'));
        allUsers = [];
        snap.forEach(d => {
            const data = d.data();
            const role = (data.role || 'user').toLowerCase();
            if (role === 'admin') return;           // admins cannot be assigned tasks here
            allUsers.push({
                uid:      d.id,
                fullName: data.fullName || data.email || d.id,
                email:    data.email || '',
                role
            });
        });
        populatePeople('');
    } catch (err) {
        console.warn('assign-actions: could not load users:', err);
    }
}

function populatePeople(roleFilter) {
    const sel = document.getElementById('assignPerson');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select person…</option>';
    for (const u of allUsers) {
        if (roleFilter && u.role !== roleFilter) continue;
        const opt = document.createElement('option');
        opt.value = u.uid;
        opt.dataset.role = u.role;
        opt.textContent = u.fullName + (u.email ? ` (${u.email})` : '');
        sel.appendChild(opt);
    }
}

// ── Tasks table ───────────────────────────────────────────────────────────
const STATUS_CLASS = {
    pending:      'status-pending',
    'in-progress':'status-in-progress',
    done:         'status-done'
};
const STATUS_LABEL = {
    pending:      'Pending',
    'in-progress':'In progress',
    done:         'Done'
};

function fmtDate(str) {
    if (!str) return '—';
    const d = new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? str
        : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Web technician writes 'completed'; the mobile app writes 'done' — both mean finished.
const DONE_STATUSES = new Set(['done', 'completed']);

// Overdue = due date is a calendar day before today AND the task isn't finished.
// Due-today is NOT overdue (still has the whole day). Missing/invalid dueDate → not overdue.
function isOverdue(task) {
    if (DONE_STATUSES.has(String(task.status || '').trim().toLowerCase())) return false;
    if (typeof task.dueDate !== 'string' || !task.dueDate) return false;
    const due = new Date(task.dueDate + 'T00:00:00');       // local midnight of due day (same as fmtDate)
    if (Number.isNaN(due.getTime())) return false;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return due < startOfToday;
}

function renderTasks(snapshot) {
    const tbody = document.getElementById('assignmentsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (snapshot.empty) {
        tbody.innerHTML = `
            <tr><td colspan="6">
                <div class="empty-state">
                    <i class="fa-solid fa-clipboard-list"></i>
                    <p>No assignments yet. Use the form above to assign a task.</p>
                </div>
            </td></tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const d      = docSnap.data();
        const status = d.status || 'pending';
        const role   = d.assignedToRole || '';
        const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '—';

        const tr = document.createElement('tr');
        if (isOverdue(d)) tr.classList.add('task-overdue');
        tr.innerHTML = `
            <td>${d.assignedToName || '—'}</td>
            <td>${roleLabel}</td>
            <td>${d.title || '—'}</td>
            <td>${fmtDate(d.dueDate)}</td>
            <td><span class="status-badge ${STATUS_CLASS[status] || 'status-pending'}">${STATUS_LABEL[status] || 'Pending'}</span></td>
            <td><button type="button" class="btn-remove" title="Delete task"><i class="fa-solid fa-trash-can"></i></button></td>
        `;

        tr.querySelector('.btn-remove').addEventListener('click', async () => {
            if (!confirm(`Delete task "${d.title || 'this task'}"? This cannot be undone.`)) return;
            try {
                await deleteDoc(doc(db, 'tasks', docSnap.id));
                showToast('Task deleted');
            } catch (err) {
                showToast('Failed to delete: ' + (err.code || err.message), 'error');
                console.error('deleteDoc tasks:', err);
            }
        });

        tbody.appendChild(tr);
    });
}

// ── Form submit → save task to Firestore ──────────────────────────────────
async function handleSubmit(e) {
    e.preventDefault();
    const roleVal    = document.getElementById('assignRole').value;
    const personUid  = document.getElementById('assignPerson').value;
    const title      = document.getElementById('actionType').value;
    const dueDate    = document.getElementById('dueDate').value;
    const description = (document.getElementById('notes').value || '').trim();

    if (!personUid || !title || !dueDate) return;

    const user = allUsers.find(u => u.uid === personUid);
    const btn  = document.querySelector('.btn-assign');

    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Assigning…'; }

        const taskPayload = {
            title,
            description,
            assignedTo:     personUid,
            assignedToName: user?.fullName || personUid,
            assignedToRole: user?.role     || roleVal,
            assignedBy:     currentUserUid,
            createdBy:      currentUserUid,   // required by Firestore security rule
            dueDate,
            status:    'pending',
            createdAt: serverTimestamp()
        };
        if (alertCtx.alertId) {
            taskPayload.alertId        = alertCtx.alertId;
            taskPayload.alertParameter = alertCtx.param || '';
        }

        const taskRef = await addDoc(collection(db, 'tasks'), taskPayload);

        // Link the alert to this task and mark it handled. Human layer only —
        // does not touch alert.status, which the alertsEngine owns.
        if (alertCtx.alertId) {
            try {
                await updateDoc(doc(db, 'alerts', alertCtx.alertId), {
                    handledAt:     serverTimestamp(),
                    handledBy:     currentUserUid,
                    handledTaskId: taskRef.id
                });
                markAlertContextHandled();
            } catch (err) {
                showToast('Task saved, but linking it to the alert failed: ' + (err.code || err.message), 'error');
                console.error('updateDoc alerts handled*:', err);
            }
        }

        document.getElementById('assignForm').reset();
        populatePeople('');
        showToast('Task assigned successfully');
    } catch (err) {
        showToast('Failed to assign task: ' + (err.code || err.message), 'error');
        console.error('addDoc tasks:', err);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Assign action'; }
    }
}

// ── Auth-gated startup ────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    currentUserUid = user.uid;

    // Pre-fill Notes from the alert context, if any (independent of the table).
    prefillFromAlert();

    // Populate the Person dropdown from real Firestore users
    await loadUsers();

    // Filter Person by role when Role select changes
    const roleSelect = document.getElementById('assignRole');
    if (roleSelect) roleSelect.addEventListener('change', () => populatePeople(roleSelect.value));

    // Wire form submit
    const form = document.getElementById('assignForm');
    if (form) form.addEventListener('submit', handleSubmit);

    // Real-time tasks table (newest first)
    onSnapshot(
        query(collection(db, 'tasks'), orderBy('createdAt', 'desc')),
        renderTasks,
        err => {
            console.error('tasks onSnapshot error:', err.code, err.message);
            const tbody = document.getElementById('assignmentsBody');
            if (tbody) tbody.innerHTML = `
                <tr><td colspan="6" style="padding:20px;color:#dc2626;text-align:center;font-size:14px;">
                    Failed to load tasks (${err.code || err.message}).
                </td></tr>`;
        }
    );
});
