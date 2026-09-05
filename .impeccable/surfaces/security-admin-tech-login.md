---
version: 1
slug: "security-admin-tech-login"
primary_target: "security/admin-tech-login"
related_targets: []
---

## Scope and visitor mode

Route: `web/pages/security/admin-tech-login.html` (+ `.css`, `.js`). Persuade-adjacent auth surface: the visitor decides to trust the product and signs in, before ever touching the operate console. Not covered by the root `DESIGN.md`, which documents the separate Operate/dashboard system — this brief exists so future work doesn't silently merge the two.

## Audience, job, proof, constraints

Admins and technicians logging in on desktop or mobile, usually once per session. Job: authenticate quickly, feel like they're entering a real, cared-for aquaculture product rather than a generic admin template. Constraint: this page is pre-authentication, so no live sensor data or product-specific proof is shown — the photo hero and copy carry the impression instead.

## Existing direction (recorded, not newly chosen)

This page already ships a deliberate, distinct identity from the Operate dashboard — the CSS header literally calls it a "photo-bg redesign." Recorded here as observed fact, not a new decision:

- **Palette:** Ulang Shell `#2E7D6F` (primary), River Clay `#C97D4A` (accent/links), Foam `#EAF4F1` (input surfaces), Ink `#1A2E2C` / Ink Soft `#2D4A47` / Ink Muted `#5A7A76` (text), Status Green `#4ade80` (live-status dot), Danger `#b83232`, Success `#1a7a4a`.
- **Typography:** Nunito (headlines, body, labels), JetBrains Mono (technical labels — status pill, eyebrow text, scroll cue), both distinct from the dashboard's Segoe UI stack.
- **Composition:** full-bleed photo background (`ulang-hero.png`) with a dark veil, a scroll-driven hero that fades as a floating white login sheet (24px radius, heavy layered shadow) rises from the bottom.
- **Form language:** 12px-radius Foam-filled inputs, Ulang-Shell focus rings, an 800-weight full-width submit button, all warmer/rounder than the dashboard's 8px utilitarian inputs.

## Unresolved decisions

- Whether this branded identity should eventually extend into the landing pages (currently separate placeholder stubs in Plus Jakarta Sans) and/or replace the dashboard's generic look is explicitly not decided — out of scope for this brief.
- No direction contract (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM/FINISH) has been authored for this page; if it is rebuilt or extended, run `/impeccable new-work` for a proper contract rather than treating this brief as one.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
