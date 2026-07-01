import { auth, db } from "../../../assets/js/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    collection, doc, getDocs, orderBy, query, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const AUTH_SESSION_KEY = "bantay-ulang-auth-user";
const LOGIN_PAGE = "../security/admin-tech-login.html";

let allTasks = [];
let currentFilter = "all";

function getSessionProfileId() {
    try {
        const raw = localStorage.getItem(AUTH_SESSION_KEY) || sessionStorage.getItem(AUTH_SESSION_KEY);
        if (raw) return JSON.parse(raw)?.profileId || null;
    } catch (_) {}
    return null;
}

function normalizeStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "done" || s === "completed") return "completed";
    if (s === "in-progress" || s === "in_progress" || s === "inprogress") return "in-progress";
    return "pending";
}

function normalizePriority(task) {
    const raw = task.priority || task.taskPriority || task.severityTriggered || "";
    const p = String(raw).trim().toLowerCase();
    if (p.includes("critical")) return "critical";
    if (p.includes("high")) return "high";
    if (p.includes("medium")) return "medium";
    if (p.includes("low")) return "low";
    return "";
}

function formatDate(value) {
    if (!value) return "—";
    const date = value?.toDate ? value.toDate() : new Date(typeof value === "string" ? value + "T00:00:00" : value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function updateFilterCounts() {
    var counts = { all: allTasks.length, pending: 0, "in-progress": 0, completed: 0 };
    allTasks.forEach(function(t) {
        var s = normalizeStatus(t.status);
        if (counts[s] !== undefined) counts[s]++;
    });
    document.querySelectorAll(".task-filter-count").forEach(function(el) {
        var key = el.getAttribute("data-for");
        if (key && counts[key] !== undefined) el.textContent = "(" + counts[key] + ")";
    });
}

function applyFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll("#taskList .task-card").forEach(function(card) {
        var status = card.getAttribute("data-status");
        card.style.display = (filter === "all" || status === filter) ? "" : "none";
    });
}

async function setTaskStatus(taskId, newStatus, card) {
    try {
        await updateDoc(doc(db, "tasks", taskId), { status: newStatus });
        var task = allTasks.find(function(t) { return t.id === taskId; });
        if (task) task.status = newStatus;
        card.setAttribute("data-status", newStatus);
        var dot = card.querySelector(".task-status-dot");
        var label = card.querySelector(".task-status-label");
        if (dot) dot.className = "task-status-dot " + newStatus;
        if (label) label.textContent = newStatus === "in-progress" ? "IN PROGRESS" : newStatus.toUpperCase();
        updateFilterCounts();
        applyFilter(currentFilter);
    } catch (err) {
        console.error("Failed to update task status:", err);
    }
}

function wireCardButtons(article, task) {
    var startBtn   = article.querySelector(".btn-start-working");
    var completeBtn = article.querySelector(".btn-mark-complete");
    var detailsBtn  = article.querySelector(".btn-show-details");

    if (startBtn) {
        startBtn.addEventListener("click", function() {
            if (startBtn.disabled) return;
            setTaskStatus(task.id, "in-progress", article);
        });
    }

    if (completeBtn) {
        completeBtn.addEventListener("click", function() {
            setTaskStatus(task.id, "completed", article);
        });
    }

    if (detailsBtn) {
        detailsBtn.addEventListener("click", function() {
            var details = article.querySelector(".task-card-details");
            if (!details) return;
            var isOpen = details.classList.toggle("show");
            var icon = detailsBtn.querySelector("i");
            if (icon) icon.className = isOpen ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
            var textNode = Array.prototype.find.call(detailsBtn.childNodes, function(n) { return n.nodeType === 3; });
            if (textNode) textNode.textContent = " " + (isOpen ? "Hide Details" : "Show Details");
            detailsBtn.setAttribute("aria-label", isOpen ? "Hide details" : "Show details");
        });
    }
}

function createTaskCard(task) {
    var status = normalizeStatus(task.status);
    var priority = normalizePriority(task);
    var priorityLabel = priority ? priority.toUpperCase() : "NORMAL";
    var statusLabel = status === "in-progress" ? "IN PROGRESS" : status.toUpperCase();

    var article = document.createElement("article");
    article.className = "task-card" + (priority ? " " + priority : "");
    article.setAttribute("data-status", status);

    var descHtml = task.description
        ? '<p class="task-card-desc">' + task.description + "</p>"
        : "";

    var dueDateHtml = task.dueDate
        ? '<span class="task-meta-item">' +
            '<i class="fa-regular fa-clock"></i>' +
            '<span class="task-meta-label">Due Date</span>' +
            '<span class="task-meta-value">' + formatDate(task.dueDate) + "</span>" +
          "</span>"
        : "";

    var severityHtml = task.severityTriggered
        ? '<span class="task-meta-item">' +
            '<i class="fa-solid fa-triangle-exclamation"></i>' +
            '<span class="task-meta-label">Triggered By</span>' +
            '<span class="task-meta-value">' + String(task.severityTriggered).toUpperCase() + "</span>" +
          "</span>"
        : "";

    var assignedByLabel = task.assignedBy === "system"
        ? "System (Auto)"
        : (task.assignedByName || task.assignedBy || "");
    var assignedByHtml = assignedByLabel
        ? '<div class="task-detail-row-box">' +
            '<i class="fa-solid fa-user task-detail-icon-green"></i>' +
            '<span class="task-detail-label">Assigned By</span>' +
            '<span class="task-detail-value">' + assignedByLabel + "</span>" +
          "</div>"
        : "";

    article.innerHTML =
        '<div class="task-card-top">' +
            '<span class="task-priority-badge' + (priority ? " " + priority : "") + '">' + priorityLabel + "</span>" +
            '<span class="task-status-dot ' + status + '"></span>' +
            '<span class="task-status-label">' + statusLabel + "</span>" +
        "</div>" +
        '<h2 class="task-card-title">' + (task.title || "Untitled Task") + "</h2>" +
        descHtml +
        '<div class="task-card-meta">' +
            '<span class="task-meta-item">' +
                '<i class="fa-regular fa-calendar"></i>' +
                '<span class="task-meta-label">Assigned</span>' +
                '<span class="task-meta-value">' + formatDate(task.createdAt) + "</span>" +
            "</span>" +
            dueDateHtml +
            severityHtml +
        "</div>" +
        '<div class="task-card-actions">' +
            '<button type="button" class="btn-start-working"><i class="fa-solid fa-play"></i> Start Working</button>' +
            '<button type="button" class="btn-mark-complete"><i class="fa-solid fa-check"></i> Mark as complete</button>' +
            '<button type="button" class="btn-task-completed" disabled><i class="fa-solid fa-circle-check"></i> Task Completed</button>' +
            '<button type="button" class="btn-show-details"><i class="fa-solid fa-chevron-down"></i> Show Details</button>' +
        "</div>" +
        '<div class="task-card-details">' +
            '<div class="task-details-grid">' +
                '<div class="task-detail-block">' +
                    '<h3 class="task-detail-heading"><i class="fa-solid fa-circle-info"></i> Task Info</h3>' +
                    '<div class="task-detail-row-box">' +
                        '<i class="fa-regular fa-clock task-detail-icon-orange"></i>' +
                        '<span class="task-detail-label">Task Created</span>' +
                        '<span class="task-detail-value">' + formatDate(task.createdAt) + "</span>" +
                    "</div>" +
                    assignedByHtml +
                "</div>" +
                '<div class="task-detail-block">' +
                    '<h3 class="task-detail-heading"><i class="fa-solid fa-circle-exclamation"></i> Additional Notes</h3>' +
                    '<div class="task-notes-box">' + (task.description || "No additional notes.") + "</div>" +
                "</div>" +
            "</div>" +
        "</div>";

    wireCardButtons(article, task);
    return article;
}

function renderTasks(tasks) {
    var list = document.getElementById("taskList");
    if (!list) return;
    list.innerHTML = "";

    if (!tasks.length) {
        var empty = document.createElement("div");
        empty.style.cssText = "text-align:center;padding:48px 24px;color:#6b7280;background:#fff;border-radius:12px;border:1px solid #e5e7eb";
        empty.innerHTML =
            '<i class="fa-solid fa-clipboard-list" style="font-size:36px;display:block;margin-bottom:12px;color:#d1d5db"></i>' +
            "No tasks assigned to you yet.";
        list.appendChild(empty);
        return;
    }

    tasks.forEach(function(task) {
        list.appendChild(createTaskCard(task));
    });
    updateFilterCounts();
    applyFilter(currentFilter);
}

async function loadTasks(assignedToId) {
    try {
        var snap = await getDocs(
            query(collection(db, "tasks"), where("assignedTo", "==", assignedToId), orderBy("createdAt", "desc"))
        );
        allTasks = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
        renderTasks(allTasks);
    } catch (err) {
        console.error("Unable to load tasks:", err);
        renderTasks([]);
    }
}

document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll(".task-filter-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
            var filter = btn.getAttribute("data-filter");
            document.querySelectorAll(".task-filter-btn").forEach(function(b) {
                b.classList.toggle("active", b === btn);
                b.setAttribute("aria-pressed", b === btn ? "true" : "false");
            });
            applyFilter(filter);
        });
    });

    onAuthStateChanged(auth, function(user) {
        if (!user) {
            window.location.href = LOGIN_PAGE;
            return;
        }
        var assignedToId = getSessionProfileId() || user.uid;
        loadTasks(assignedToId);
    });
});
