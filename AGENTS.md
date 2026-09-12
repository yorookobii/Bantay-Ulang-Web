# Agent Working Rules — Bantay Ulang

These are standing instructions for any AI coding agent working on this
codebase (Antigravity CLI, Claude Code, etc.). Follow them on EVERY task
without being re-told. They encode how this project is worked on.

---

## 1. PLAN FIRST — do not edit until approved

- For any change beyond a one-line trivial fix: **produce a PLAN first,
  then STOP and wait for approval.** Do not edit files until the human
  says go.
- The plan must show: which files change, the exact edit (or the diff),
  and the reasoning. Cite `file:line` for everything you're changing or
  relying on.
- If the agent auto-applies edits by default: after editing, immediately
  show `git diff` of every changed file and STOP for review before doing
  anything else (especially before committing).

## 2. CITE FILE:LINE — verify, never assume

- Every claim about the code — a threshold, a field name, a status value,
  a function's behavior — must be backed by `file:line`. Quote the actual
  code.
- Never assume a value or behavior. If it's not confirmed in the code,
  say "unconfirmed — needs checking" rather than guessing.
- For data-dependent facts (what's actually in Firestore, cadence,
  counts), say explicitly that it must be verified against the live data,
  not inferred from code.

## 3. NO DUPLICATION — reuse via shared modules

- Before copying logic into a second place, extract it into ONE shared
  module both callers import. Duplicated logic drifts and causes bugs
  (this project has hit this repeatedly: status normalization, sidebar
  logic, chart code).
- If reusing existing code, confirm the exact function/constant and reuse
  it — don't re-implement.
- Flag any place the change leaves two copies of the same logic.

## 4. TEST BEFORE COMMIT — never commit untested

- After a change: `node --check` any touched JS (syntax), THEN actually
  RUN/RENDER it — open the page, click the thing, watch the behavior.
  Syntax passing is not "it works."
- For UI changes: confirm it renders in the browser (hard-refresh,
  Ctrl+Shift+R).
- Do not commit until the human confirms it behaves correctly.

## 5. COMMIT DISCIPLINE — specific files only

- **NEVER `git add .`** Stage specific files by explicit path.
- Always `git status` before committing and confirm ONLY the intended
  files are staged.
- One logical change per commit, with a clear message.
- **Always keep these OUT of every commit** (they are intentionally
  untracked / not ours to commit):
  - `CLAUDE.md`
  - `.impeccable/`, `DESIGN.md`, and the impeccable tooling binaries
  - the `flutter-latest` submodule pointer (commit inside the submodule
    separately if its code changed; don't bump the pointer casually)
  - any scratch/diagnostic scripts (e.g. `check_history.py`)
  - stray files with garbled names
- On Windows the `LF will be replaced by CRLF` warning is harmless —
  ignore it.

## 6. FLAG, DON'T HIDE — surface risks and unknowns

- If a plan has a risk, an edge case, or an assumption, SAY SO explicitly
  in the plan. Do not present a shaky mechanism as certain.
- Known risky patterns to always call out:
  - cache/memoization staleness (a re-read that returns stale cached data)
  - listener leaks (event listeners added per-open instead of once)
  - null/missing data plotted or counted as zero (should be a gap/skip)
  - off-by-one on boundaries (e.g. "due today" vs overdue; range edges)
  - order-of-checks (e.g. out-of-range must be checked before near-edge)
- When two designs are possible, lay out the tradeoff and recommend one —
  don't silently pick.

## 7. RESPECT THE HONESTY STANDARD ("saan gal.")

- Every number, threshold, and claim must have a real basis. No invented
  defaults presented as real. No overclaiming.
- If data is synthetic or a test connection, say so — don't dress it as
  live/real.
- Match claims to evidence: "mentioned once" is not "always"; a barely-out
  reading is still out of range.

## 8. DOMAIN NOTES specific to this project

- **Task status** is written inconsistently: web writes `completed`,
  mobile writes `done`. Always normalize via the shared `normalizeStatus`
  (both mean "done"). Never compare the raw string.
- **Two data sources:** `Aquaponics/Ulang` = live single doc (~15s,
  onSnapshot) drives real-time cards + live chart. `HistoryLogs` =
  historical collection (per-reading docs) drives trends. Don't confuse
  them.
- **pH field name differs:** the live event uses `phLevel`; the history
  normalizer and chart config use `ph`. Map correctly.
- **Alerts** resolve when the PARAMETER returns to safe range — NOT when a
  task is marked done. `handledAt` (someone acted) is separate from
  `status: resolved` (the water is actually fine).
- **Sidebar/shell markup is duplicated per page** (not templated) — a new
  page means copying the shell; a nav entry means editing every page.
  Prefer reaching new pages via a link from another page (like all-alerts,
  logs) to avoid the multi-file edit.
- **Firestore reads cost money** — free tier 50k/day. Prefer reusing the
  IndexedDB cache and the existing shared read paths over new queries.

## 9. WORKING RHYTHM

- Plan → (approve) → apply specific edit → `node --check` → human tests in
  browser → stage specific files → `git status` → commit → push.
- Keep changes atomic. Don't bundle an unrelated fix into a feature commit.
- If a change grows large or a connection drops mid-task, it's fine to
  stop, commit what's done and tested, and continue fresh.
