import { auth, db } from "../../../assets/js/firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const AUTH_SESSION_KEY = "bantay-ulang-auth-user";
const LOGIN_PAGE = "../security/admin-tech-login.html";

function clearSavedAuthSession() {
    try {
        localStorage.removeItem(AUTH_SESSION_KEY);
        sessionStorage.removeItem(AUTH_SESSION_KEY);
    } catch (error) {
        console.warn("Unable to clear saved auth session.", error);
    }
}

function getSessionProfileId() {
    try {
        const raw = localStorage.getItem(AUTH_SESSION_KEY) || sessionStorage.getItem(AUTH_SESSION_KEY);
        if (raw) return JSON.parse(raw)?.profileId || null;
    } catch (_) {}
    return null;
}

async function handleLogout(logoutElement, profileDropdown) {
    const originalLabel = logoutElement ? logoutElement.textContent : "Logout";

    if (logoutElement) {
        logoutElement.style.pointerEvents = "none";
        logoutElement.style.opacity = "0.6";
        logoutElement.textContent = "Signing out...";
    }

    if (profileDropdown) {
        profileDropdown.classList.remove("show");
    }

    try {
        await signOut(auth);
        clearSavedAuthSession();
        window.location.href = LOGIN_PAGE;
    } catch (error) {
        console.error("Logout failed:", error);

        if (logoutElement) {
            logoutElement.textContent = originalLabel;
            logoutElement.style.pointerEvents = "";
            logoutElement.style.opacity = "";
        }

        window.alert("Unable to log out right now. Please try again.");
    }
}

function getTaskField(task, keys, fallback = "") {
    for (const key of keys) {
        const value = task?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value);
        }
    }

    return fallback;
}

function normalizePriority(priorityValue) {
    const priority = String(priorityValue || "").trim().toLowerCase();

    if (priority.includes("critical")) return "critical";
    if (priority.includes("high")) return "high";
    if (priority.includes("medium")) return "medium";
    if (priority.includes("low")) return "low";

    return priority || "normal";
}

function formatLabel(value, fallback) {
    const text = String(value || "").trim();
    if (!text) return fallback;

    return text
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, function(character) {
            return character.toUpperCase();
        });
}

function getPriorityClass(priority) {
    return priority === "critical" || priority === "high" ? priority : "";
}

function createTaskMetaRow(iconClass, text) {
    const row = document.createElement("div");
    row.className = "task-meta";

    const detail = document.createElement("span");
    const icon = document.createElement("i");
    icon.className = iconClass;

    detail.appendChild(icon);
    detail.appendChild(document.createTextNode(text));
    row.appendChild(detail);

    return row;
}

function renderNoAssignedTasks(message = "No assigned tasks.") {
    const tasksList = document.getElementById("technician-tasks-list");
    if (!tasksList) return;

    tasksList.innerHTML = "";

    const emptyCard = document.createElement("div");
    emptyCard.className = "urgent-task-card";

    const title = document.createElement("div");
    title.className = "task-name";
    title.textContent = message;

    emptyCard.appendChild(title);
    tasksList.appendChild(emptyCard);
}

function createTaskCard(task) {
    const priority = normalizePriority(getTaskField(task, ["priority", "taskPriority"], "normal"));
    const priorityLabel = formatLabel(priority, "Normal");
    const statusLabel = formatLabel(getTaskField(task, ["status", "taskStatus"], "Pending"), "Pending");
    const cardClass = getPriorityClass(priority);

    const card = document.createElement("div");
    card.className = cardClass ? "urgent-task-card " + cardClass : "urgent-task-card";

    const badge = document.createElement("span");
    badge.className = cardClass ? "task-badge " + cardClass : "task-badge";
    badge.textContent = priorityLabel.toUpperCase();

    const title = document.createElement("div");
    title.className = "task-name";
    title.textContent = getTaskField(task, ["title", "taskTitle", "name"], "Untitled Task");

    const description = createTaskMetaRow(
        "fa-regular fa-file-lines",
        getTaskField(task, ["description", "details"], "No description provided.")
    );

    const statusAndPriority = document.createElement("div");
    statusAndPriority.className = "task-meta";

    const status = document.createElement("span");
    const statusIcon = document.createElement("i");
    statusIcon.className = "fa-solid fa-bars-progress";
    status.appendChild(statusIcon);
    status.appendChild(document.createTextNode("Status: " + statusLabel));

    const priorityInfo = document.createElement("span");
    const priorityIcon = document.createElement("i");
    priorityIcon.className = "fa-solid fa-flag";
    priorityInfo.appendChild(priorityIcon);
    priorityInfo.appendChild(document.createTextNode("Priority: " + priorityLabel));

    statusAndPriority.appendChild(status);
    statusAndPriority.appendChild(priorityInfo);

    card.appendChild(badge);
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(statusAndPriority);

    return card;
}

function renderTechnicianTasks(tasks) {
    const tasksList = document.getElementById("technician-tasks-list");
    if (!tasksList) return;

    tasksList.innerHTML = "";

    if (!tasks.length) {
        renderNoAssignedTasks();
        return;
    }

    tasks.forEach(function(task) {
        tasksList.appendChild(createTaskCard(task));
    });
}

async function loadTechnicianTasks(assignedToId) {
    if (!assignedToId) {
        renderNoAssignedTasks();
        return;
    }

    try {
        const tasksQuery = query(
            collection(db, "tasks"),
            where("assignedTo", "==", assignedToId),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(tasksQuery);
        const tasks = snapshot.docs.map(function(taskDoc) {
            return { id: taskDoc.id, ...taskDoc.data() };
        });

        renderTechnicianTasks(tasks);
    } catch (error) {
        console.error("Unable to load technician tasks:", error);
        renderNoAssignedTasks();
    }
}

async function loadSummaryCards(assignedToId) {
    const now = new Date();
    const schedValue = document.getElementById("sched-value");
    const schedNext  = document.getElementById("sched-next");
    if (schedValue) schedValue.textContent = now.toLocaleDateString("en-US", { weekday: "long" });
    if (schedNext)  schedNext.textContent  = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    try {
        const tasksSnap = await getDocs(
            query(collection(db, "tasks"), where("assignedTo", "==", assignedToId))
        );
        var pending = 0, inProgress = 0, done = 0;
        tasksSnap.forEach(function(d) {
            var s = String(d.data().status || "pending").toLowerCase();
            if (s === "in-progress" || s === "in_progress") { inProgress++; }
            else if (s === "done" || s === "completed") { done++; }
            else { pending++; }
        });
        var tasksValue = document.getElementById("tasks-value");
        var tasksDesc  = document.getElementById("tasks-desc");
        var tasksProg  = document.getElementById("tasks-meta-progress");
        var tasksDone  = document.getElementById("tasks-meta-done");
        if (tasksValue) tasksValue.textContent = pending;
        if (tasksDesc)  tasksDesc.textContent  = pending === 1 ? "Pending task" : "Pending tasks";
        if (tasksProg)  tasksProg.textContent   = inProgress + " In Progress";
        if (tasksDone)  tasksDone.textContent   = done + " Done";
    } catch (error) {
        console.error("Unable to load task summary:", error);
    }

    try {
        var alertsSnap = await getDocs(
            query(collection(db, "alerts"), where("status", "==", "active"))
        );
        var count   = alertsSnap.size;
        var hwValue = document.getElementById("hw-value");
        var hwDesc  = document.getElementById("hw-desc");
        var hwWarn  = document.getElementById("hw-meta-warn");
        var hwDot   = document.getElementById("hw-meta-dot");
        if (hwValue) hwValue.textContent = count;
        if (hwDesc)  hwDesc.textContent  = count === 1 ? "Active alert" : "Active alerts";
        if (hwWarn)  hwWarn.textContent  = count > 0 ? "Needs attention" : "All clear";
        if (hwDot)   hwDot.style.display = count > 0 ? "" : "none";
    } catch (error) {
        console.error("Unable to load hardware summary:", error);
    }
}

function initTechnicianTasks() {
    onAuthStateChanged(auth, function(currentUser) {
        if (!currentUser) {
            renderNoAssignedTasks();
            return;
        }

        var assignedToId = getSessionProfileId() || currentUser.uid;
        loadTechnicianTasks(assignedToId);
        loadSummaryCards(assignedToId);
    });
}

(function() {
    function init() {
        var container = document.querySelector(".topbar");
        if (!container) return;

        var notifDropdown = container.querySelector(".notification-dropdown");
        var profileDropdown = container.querySelector(".profile-dropdown");
        var notifBtn = container.querySelector(".notification-icon");
        var profileBtn = container.querySelector(".admin-profile");

        if (notifBtn && notifDropdown) {
            notifBtn.addEventListener("click", function(e) {
                e.stopPropagation();
                notifDropdown.classList.toggle("show");
                if (profileDropdown) profileDropdown.classList.remove("show");
            });
        }

        if (profileBtn && profileDropdown) {
            profileBtn.addEventListener("click", function(e) {
                e.stopPropagation();
                profileDropdown.classList.toggle("show");
                if (notifDropdown) notifDropdown.classList.remove("show");
            });
        }

        document.addEventListener("click", function(e) {
            if (container.contains(e.target)) return;
            if (notifDropdown) notifDropdown.classList.remove("show");
            if (profileDropdown) profileDropdown.classList.remove("show");
        });

        var menuItems = container.querySelectorAll(".profile-menu-item");
        menuItems.forEach(function(item) {
            if (item.textContent.indexOf("Logout") !== -1) {
                item.addEventListener("click", function() {
                    handleLogout(item, profileDropdown);
                });
            }
        });

        var sidebar = document.getElementById("sidebar");
        var overlay = document.getElementById("sidebarOverlay");
        var menuBtn = document.getElementById("topbarMenuBtn");
        var app = document.querySelector(".app");

        if (sidebar && overlay && menuBtn) {
            menuBtn.addEventListener("click", function() {
                sidebar.classList.add("open");
                overlay.classList.add("show");
                overlay.setAttribute("aria-hidden", "false");
            });

            overlay.addEventListener("click", function() {
                sidebar.classList.remove("open");
                overlay.classList.remove("show");
                overlay.setAttribute("aria-hidden", "true");
            });
        }

        var sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
        if (sidebar && app && sidebarToggleBtn) {
            function isMobile() { return window.innerWidth <= 768; }

            function setCollapsed(collapsed) {
                if (collapsed) {
                    sidebar.classList.add("collapsed");
                    app.classList.add("sidebar-collapsed");
                } else {
                    sidebar.classList.remove("collapsed");
                    app.classList.remove("sidebar-collapsed");
                }

                try {
                    localStorage.setItem("dashboard-sidebar-collapsed", collapsed ? "1" : "0");
                } catch (e) {}
            }

            sidebarToggleBtn.addEventListener("click", function() {
                if (isMobile()) {
                    sidebar.classList.remove("open");
                    if (overlay) {
                        overlay.classList.remove("show");
                        overlay.setAttribute("aria-hidden", "true");
                    }
                } else {
                    var collapsed = !sidebar.classList.contains("collapsed");
                    setCollapsed(collapsed);
                    sidebarToggleBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
                }
            });

            if (!isMobile()) {
                try {
                    var saved = localStorage.getItem("dashboard-sidebar-collapsed");
                    if (saved === "1") setCollapsed(true);
                    if (saved === "1") sidebarToggleBtn.setAttribute("aria-label", "Expand sidebar");
                } catch (e) {}
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

document.addEventListener("DOMContentLoaded", function() {
    var dateEl = document.getElementById("dashboardDate");
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric"
        });
    }

    initTechnicianTasks();
});
