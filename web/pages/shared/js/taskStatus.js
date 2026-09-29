// Task status is written inconsistently: the web technician page writes
// "completed", the mobile app writes "done". Every reader normalizes through
// this before comparing / mapping.
export function normalizeStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "done" || s === "completed") return "completed";
    if (s === "in-progress" || s === "in_progress" || s === "inprogress") return "in-progress";
    return "pending";
}

// Overdue = due date is a calendar day before today and the task isn't finished; due-today and missing/invalid dates are not overdue.
export function isOverdue(task, now = Date.now()) {
    if (normalizeStatus(task.status) === "completed") return false;
    if (typeof task.dueDate !== "string" || !task.dueDate) return false;
    const due = new Date(task.dueDate + "T00:00:00");       // local midnight of the due day
    if (Number.isNaN(due.getTime())) return false;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return due < startOfToday;
}
