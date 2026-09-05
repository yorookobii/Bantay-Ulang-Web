---
name: Bantay Ulang
description: Aquaponics operations dashboard for admins and technicians managing an ulang (freshwater prawn) + vegetable closed-loop system.
colors:
  working-teal: "#0d9488"
  active-emerald: "#10b981"
  deep-water-navy: "#15212e"
  mist-gray: "#f3f4f6"
  cloud-white: "#ffffff"
  border-gray: "#e5e7eb"
  ink: "#111827"
  slate: "#6b7280"
  critical-red: "#dc2626"
  critical-red-bg: "#fee2e2"
  warning-amber: "#d97706"
  warning-amber-bg: "#fef3c7"
  success-green: "#059669"
  success-green-bg: "#d1fae5"
  info-blue: "#2563eb"
  info-blue-bg: "#dbeafe"
typography:
  title:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
  metric:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "24px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.working-teal}"
    textColor: "{colors.cloud-white}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "#374151"
  status-badge-optimal:
    backgroundColor: "{colors.success-green-bg}"
    textColor: "{colors.success-green}"
    rounded: "{rounded.pill}"
  status-badge-critical:
    backgroundColor: "{colors.critical-red-bg}"
    textColor: "{colors.critical-red}"
    rounded: "{rounded.pill}"
---

# Design System: Bantay Ulang

## Overview

**Creative North Star: "The Aquarist's Console"**

Bantay Ulang's admin/technician dashboard reads as an instrument panel for a working aquaculture site, not a marketing surface. A near-black navy sidebar anchors the eye like a control-room rail; the working area is a calm, low-saturation gray so sensor numbers, charts, and alerts carry the contrast. Every screen is built to be scanned in seconds during a shift, then acted on: a metric, a trend, a status pill, an assignable task. The one warm move in an otherwise neutral system is Working Teal, spent only on the single primary action per screen, so it always reads as "do this next."

This system deliberately does not try to be the product's brand voice. The system-native Segoe UI stack, flat white cards, and restrained accent are workhorse choices for an Operate surface: reachable at a glance, forgettable in a good way, and correct across the admin's long dashboard sessions and the technician's shorter task-completion visits.

**Key Characteristics:**
- Navy control rail (sidebar) against a mist-gray working surface
- One accent, Working Teal, spent only on primary actions
- Whisper-flat cards: hairline border, almost no shadow at rest
- Severity communicated through color-coded pill badges and left-border banner strips, never through icon alone
- System font stack throughout; no display typeface

## Colors

The palette is restrained: one working accent, a navy/gray neutral scaffold, and a fixed semantic vocabulary for status. No secondary or tertiary brand color is used outside these roles.

### Primary
- **Working Teal** (`#0d9488`): the single primary-action color — "Generate Report," "Add Sensor," "Save Threshold." Reserved for one button per screen; never used decoratively.

### Secondary
- **Active Emerald** (`#10b981`): marks "this is currently selected/succeeding" — the active sidebar item's left border and background tint, input focus rings, optimal-status pills, and the "View All" link color. Distinct from Working Teal so a visitor never confuses "click this" with "this is already true."

### Neutral
- **Deep Water Navy** (`#15212e`): sidebar and sidebar-footer background — the fixed control rail.
- **Mist Gray** (`#f3f4f6`): page background — the working surface everything else sits on.
- **Cloud White** (`#ffffff`): card, modal, and topbar-dropdown surfaces.
- **Border Gray** (`#e5e7eb`): the hairline border on every card, input, and divider.
- **Ink** (`#111827`): headings, metric values, primary text.
- **Slate** (`#6b7280`): secondary text — subtitles, meta labels, helper copy.

### Status (semantic)
Each severity is a fixed background/foreground pair, reused identically across metric-card icons, sensor status pills, alert banners, and badge chips — never recombined or reused for anything non-semantic.
- **Critical Red** (`#dc2626` on `#fee2e2`): critical alerts, destructive hover states, mortality stat.
- **Warning Amber** (`#d97706` on `#fef3c7`): warning-tier sensor readings and alerts.
- **Success Green** (`#059669` on `#d1fae5`): optimal/normal status, positive trend arrows.
- **Info Blue** (`#2563eb` on `#dbeafe`): informational emphasis — sensor live-value color, "population/yield" metric icon, low-severity alerts.

### Named Rules
**The One Action Rule.** Working Teal appears on at most one button per screen — the primary action. Every other actionable element is either neutral (ghost/text) or a status color carrying semantic meaning, never a second brand accent.

## Typography

**Body/UI Font:** Segoe UI (with Tahoma, Geneva, Verdana, sans-serif fallback) — the Windows/system UI stack, used for every weight and size in the system. No separate display or mono face.

**Character:** Purely functional and native-feeling; hierarchy is carried by size and weight, not by typeface change, which keeps the console feeling like an OS-level tool rather than a designed brand surface.

### Hierarchy
- **Title** (700, 26px, 1.2): page headings ("Admin Overview," "Real-Time Monitoring").
- **Metric** (700, 28px, 1.2): the large number in a metric card — the thing a shift-scan lands on first.
- **Headline** (600, 16px, 1.4): card/panel titles ("Environmental Trends," "Recent System Logs").
- **Body** (400, 14px, 1.5): running copy, list items, form values.
- **Label** (500, 12px, 0.04em tracking): status pills, meta text (timestamps, actor names), usually uppercase where it denotes a category rather than a sentence.

### Named Rules
**The No-Display-Face Rule.** This system never introduces a second font family. A brief that wants a distinct brand voice belongs in a different surface (see the login/auth surface brief), not in this console.

## Layout

Fixed two-region shell: a 260px navy sidebar (collapsing to a 72px icon rail above 769px width, or an off-canvas drawer with a scrim below it) and a topbar fixed to its right at 72px tall. Content sits below both, padded `24px 30px 40px` on a mist-gray canvas. Grids are simple CSS Grid rows: a 3-column metrics row, a ~1.2:1 charts row, and full-width panel rows, all collapsing to a single column at 1024px and below. Card gaps hold to 20px throughout; nothing nests grids more than one level deep.

## Elevation & Depth

**Whisper-flat.** At rest, cards are nearly flat: a 1px `#e5e7eb` border plus a barely-there `0 1px 3px rgba(0,0,0,0.08)` shadow — just enough to separate a card from the mist-gray canvas, not enough to feel "lifted." Shadow strength is spent almost entirely on temporary overlays: dropdowns and modals use a visibly heavier shadow (`0 4px 12px` to `0 20px 40px rgba(0,0,0,0.1–0.22)`) to signal "this floats above the deck and needs a dismiss." The sidebar itself uses a directional shadow only where it borders the content, reinforcing it as a fixed rail rather than a floating panel.

### Shadow Vocabulary
- **Resting card** (`0 1px 3px rgba(0,0,0,0.08)`): metric cards, chart cards, panel cards, sensor cards.
- **Rail edge** (`2px 0 5px rgba(0,0,0,0.1)`): sidebar against content.
- **Dropdown** (`0 4px 12px rgba(0,0,0,0.1)`): notification and profile dropdowns.
- **Modal** (`0 20px 40px rgba(0,0,0,0.15)` up to `0 24px 64px rgba(0,0,0,0.22)`): report modal, sensor history modal.

### Named Rules
**The Overlay-Owns-Shadow Rule.** Anything permanently on the canvas (cards, sidebar, topbar) stays whisper-flat; only things that appear and get dismissed (modals, dropdowns) earn a heavy shadow.

## Shapes

A three-step radius scale used by role, not by size of the element: **6-8px** on interactive controls (buttons, inputs, chart dropdowns), **10-12px** on content containers (cards, panels, metric tiles), and **16-24px** on temporary overlays (modals, the sensor-history sheet). Pills (**20-25px / fully round**) are reserved for status badges, search bars, and toggle chips — anything communicating state rather than containing content. Avatars and icon wells are perfect circles.

## Components

### Buttons
- **Shape:** 8px radius, `10px 20px` padding.
- **Primary:** Working Teal (`#0d9488`) background, white text, 600 weight, 14px.
- **Hover:** darkens to `#374151` (report/save actions) or `#0f766e`/`#059669` (page-local actions like Add Sensor, Assign) — always a same-family darkening, never a hue change.
- **Ghost/ Cancel:** `#f3f4f6` background, `#374151` text, same 8px radius; used for modal "Cancel."

### Status Badges / Pills
- **Style:** fully rounded (pill), 4-10px vertical padding, 10-14px horizontal, 11-13px bold text, letter-spacing on the shortest labels.
- **Pairing:** always a status-color background at ~15% strength with the same hue at full strength for text (e.g. `#d1fae5` bg / `#059669` text), except sensor-status pills which invert to solid-fill-with-white-text for higher urgency.

### Cards (Metric / Chart / Panel / Sensor)
- **Corner Style:** 12px radius.
- **Background:** Cloud White.
- **Shadow Strategy:** resting-card shadow (see Elevation).
- **Border:** 1px `#e5e7eb`.
- **Internal Padding:** 20px.
- **Distinctive behavior:** sensor cards lift 2px and gain a colored shadow + reveal a hint icon on hover, signaling they're clickable (opens the sensor history modal); metric/chart/panel cards do not.

### Inputs / Fields
- **Style:** 1px `#e5e7eb` border, 8px radius, `10px 12px` padding, 14px text.
- **Focus:** border shifts to Active Emerald with a soft `0 0 0 2px rgba(16,185,129,0.15)` ring — no background change.
- **Error / Disabled:** not yet established in the codebase; a future form-validation pass should extend Critical Red into this state.

### Navigation (Sidebar)
- **Style:** Deep Water Navy background, `#bdc3c7` link text at rest.
- **Hover:** `#34495e` background tint, text lightens to `#ecf0f1`, left border tints blue (`#3498db`) as a legacy hover cue.
- **Active:** Active Emerald left border (3px) + `rgba(16,185,129,0.25)` background tint + `#6ee7b7` text — the one state that must never be ambiguous with hover.
- **Collapsed (desktop, ≥769px):** rail narrows to 72px, labels hide, icons center; a toggle button flips the chevron.
- **Mobile (<769px):** off-canvas drawer with a dark scrim; a hamburger button replaces the rail entirely.

### Topbar
- **Style:** Mist-adjacent light gray (`#f9fafb`) bar, fixed, sharing the 72px height with the sidebar's implicit top row.
- **Search:** fully-rounded (25px) light-gray pill field.
- **Notifications / Profile:** icon-triggered dropdowns, white surface, 6px radius, dropdown shadow (see Elevation), items separated by hairline dividers.

### Alert Banner (Top-of-page)
- **Style:** 10px radius block, 4px colored left border, tinted background matching the active severity (critical/high/medium/low/ok), a severity pill plus message text and an optional action link.

## Do's and Don'ts

### Do:
- **Do** keep Working Teal to one primary action per screen (The One Action Rule).
- **Do** reuse the fixed status-color pairs (critical/warning/success/info) identically everywhere severity is shown — pills, banners, card icons.
- **Do** keep cards whisper-flat at rest; save real shadow for modals and dropdowns.
- **Do** use the 6/8 → 10/12 → 16/24px radius bands by role (control → container → overlay), not arbitrarily.

### Don't:
- **Don't** introduce a second accent color alongside Working Teal and Active Emerald — route anything else through the semantic status palette or neutrals.
- **Don't** add a display/brand typeface to this console; that belongs to the login/marketing surfaces, not the operate dashboard (see the separate login surface brief).
- **Don't** give a resting card a heavier shadow than a dropdown or modal — that inverts the system's depth hierarchy.
- **Don't** reuse the sidebar's legacy blue hover accent (`#3498db`) as a new UI color; it's an unresolved leftover, not an intentional third accent.
