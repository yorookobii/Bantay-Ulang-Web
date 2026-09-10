// Task status is written inconsistently: the web technician page writes
// "completed", the mobile app writes "done". Every reader normalizes through
// this before comparing / mapping.
export function normalizeStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "done" || s === "completed") return "completed";
    if (s === "in-progress" || s === "in_progress" || s === "inprogress") return "in-progress";
    return "pending";
}
