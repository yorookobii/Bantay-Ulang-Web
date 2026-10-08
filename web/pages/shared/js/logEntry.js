// Shared "logs" doc field mapping (moved from logs.js so the report reads logs the same way).
import { roleLabel } from "./roleLabels.js";

export function getTextField(data, keys, fallback = "") {
    for (const key of keys) {
        const value = data?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return String(value);
        }
    }

    return fallback;
}

export function toDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Fields tried in order for a log's actor.
export const LOG_ACTOR_KEYS = ["role", "actor", "user", "source", "by", "createdByName", "createdByEmail"];

// Mirrors dashboard.js applyRecentLogsSnapshot field mapping; loggedAt is a Date or null.
export function normalizeLogData(data, id) {
    return {
        loggedAt: toDateValue(data.createdAt || data.timestamp || data.loggedAt || data.date),
        type: getTextField(data, ["status", "type", "level"], "").toLowerCase(),
        actor: roleLabel(getTextField(data, LOG_ACTOR_KEYS, "System")),
        title: getTextField(data, ["action", "title", "event", "name"], id),
        description: getTextField(data, ["details", "description", "message"], "No details provided.")
    };
}
