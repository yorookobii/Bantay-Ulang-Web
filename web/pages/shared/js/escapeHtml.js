// Shared HTML escaping for any user-controlled text placed into innerHTML templates.
// Stored XSS fix (security hardening, Oct 2026): names and titles come from Firestore
// and can be set by any signed-up user, so they must never be inserted as raw HTML.
// Prefer textContent where possible; use this only when building HTML strings.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
