// Single source for how stored role keys are shown in the UI; stored values never change.
export const ROLE_LABELS = { admin: "Admin", technician: "Technician", user: "Practitioner" };

// Maps a role key to its label, passing unknown values through unchanged.
export const roleLabel = (role) => ROLE_LABELS[String(role || "").toLowerCase()] || role || "";
