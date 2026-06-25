import { db, auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    collection, query, orderBy, onSnapshot,
    addDoc, deleteDoc, doc, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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

// ── Sidebar collapse: icon-only on desktop, close drawer on mobile ─────────
(function () {
    const sidebar = document.getElementById('sidebar');
    const app     = document.querySelector('.app');
    const btn     = document.getElementById('sidebarToggleBtn');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !app || !btn) return;
    const isMobile = () => window.innerWidth <= 768;
    const setCollapsed = (v) => {
        sidebar.classList.toggle('collapsed', v);
        app.classList.toggle('sidebar-collapsed', v);
        try { localStorage.setItem('sidebar-collapsed', v ? '1' : '0'); } catch (_) {}
    };
    btn.addEventListener('click', () => {
        if (isMobile()) {
            sidebar.classList.remove('open');
            overlay?.classList.remove('show');
            overlay?.setAttribute('aria-hidden', 'true');
        } else {
            const v = !sidebar.classList.contains('collapsed');
            setCollapsed(v);
            btn.setAttribute('aria-label', v ? 'Expand sidebar' : 'Collapse sidebar');
        }
    });
    if (!isMobile()) {
        try {
            if (localStorage.getItem('sidebar-collapsed') === '1') {
                setCollapsed(true);
                btn.setAttribute('aria-label', 'Expand sidebar');
            }
        } catch (_) {}
    }
})();

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

        await addDoc(collection(db, 'tasks'), {
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
        });

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
