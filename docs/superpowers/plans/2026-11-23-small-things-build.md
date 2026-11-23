# Small things in the mix style: build plan

> For agentic workers: executed inline (superpowers:executing-plans), on local main, committed locally; one push at the end of only this plan's commits (+ the My Work header and the first-load draw-in), cherry-picked onto origin/main in a separate worktree. Other sessions' code is never pushed.

**Goal:** every small state and control in the app (waiting, feedback, empty, controls) in the mix style, one way each, with nothing left on the old look.

**Spec:** docs/superpowers/plans/2026-11-23-small-things-audit.md (audit item numbers below), and the skeleton prototype https://claude.ai/artifact/Fc9H7ZhYRRPyUHjxdDU9Sn (v2).

**Architecture:** shared parts first (in `src/components/ui` and `src/lib`), each with a unit or browser test, then sweeps that route every call site to them, each sweep closed by a contract test that fails if the old pattern comes back.

## Global constraints
- Mix style: paper/card/ink tokens from globals.css; mono 10.5px uppercase labels; serif only for names and stat numbers; square 3–6px radii; no coloured edges on cards.
- Motion: one curve (`--nb-ease`), 150/220/300ms; every motion off under `prefers-reduced-motion` and `html[data-reduce-motion="true"]`.
- Copy: active voice, past tense for results, object first ("Link copied"), no "successfully", no "!", errors say what to do next.
- Stage named files only; `git commit -- <paths>`; never touch other sessions' uncommitted files.
- tsc with `NODE_OPTIONS=--max-old-space-size=6144`; npm lock only via `npm --package-lock-only`.

## Phase W: waiting (audit 1.1–1.8)
- **W1 Skeleton core.** One page-wide sweep (fixed background), `Skeleton` text bars at cap height (`kind="text"`), pixel ghost tile (`kind="tile"`), `useDelayedFlag(loading)` (show after 300 ms, keep 400 ms), `BusyRegion` (aria-busy + hidden "Loading {thing}"), slow line after 3 s. Replace all hand-made `animate-pulse` blocks. Contract: no `animate-pulse` outside the skeleton.
- **W2 Route skeleton kit.** `RouteSkeleton` parts in the profile style: band, tab bar, list rows, card grid, panel, thread, form.
- **W3 Loading screens.** A `loading.tsx` for every page route (47 missing), built from the kit by layout family; the 11 existing redrawn with it. Contract: every `page.tsx` directory (except redirects and static pages) has a `loading.tsx`.
- **W4 Pending without spinners.** `PixelBeat` (three cells) and `Button pending` (keeps width, beat + verb). Section spinners become skeletons; button spinners become `pending`; spinners stay only for unknown-length background work. Contract: `Loader2` only in an allow-list.
- **W5 Load more.** `LoadMoreButton` (pending beat) and appended skeleton rows; every Load more / Show more routed to it.
- **W6 Uploads.** `UploadProgress` row (name, slim bar, %, Cancel, tick); every upload progress routed to it.
- **W7 Words.** "Loading {thing}…" only in the slow line and for screen readers; `...` → `…`.

## Phase F: feedback (audit 2.1–2.7)
- **F1 Rulebook.** `src/lib/feedback/copy.ts` rules applied at emit (drop "successfully", trailing "!", "to clipboard"); every success toast rewritten object-first in past tense. Contract test over all `toast.success(` literals.
- **F2 Saved in place.** `SavedTick` (tick that pops once + "Saved"); forms whose result is on screen use it instead of a toast.
- **F3 Undo.** Reversible acts (hide, pin, remove, decline, archive) act at once with Undo; irreversible keep ConfirmDialog.
- **F4 Errors.** Field errors inline; action errors inline near the action with Try again (`ErrorNotice`); toasts only for background failures; every error string says what to do next. Contract over `toast.error(` literals.
- **F5 Confetti.** Replace both canvas-confetti uses with a pixel moment; remove the dependency.
- **F6 Copy.** Every clipboard write through `copyText`/`CopyButton`: icon → tick, "Copied" for 1.5 s.

## Phase E: empty (audit 3.1–3.2)
- **E1 EmptyState v2.** Pixel figure (person, workspace, organization or child) or icon, one title, one line, one action, optional "Only you see this" note; `NoResults` (Nothing matches "…" + Clear search).
- **E2 Sweep.** Every `nb-empty-state`, `EmptyState`, `nb-pf-empty` and ad-hoc "No … yet" routed to it. Contract: `nb-empty-state` only inside EmptyState.

## Phase C: controls (audit 4.1–4.19)
- **C1 Buttons.** One size scale (28/34/40, 44 hit on touch), press 1px, bespoke `nb-*-btn`/`nb-*-ib` mapped to variants or to one `IconButton` (32 visual, aria-label + tooltip required).
- **C2 Focus.** One keyboard-only focus style for controls; every `outline-none` paired with it. Contract test.
- **C3 Hover.** Rows soft fill, links underline, buttons one step darker.
- **C4 Switch.** One switch (SettingsSwitch); ui `Switch` and custom switches routed to it (profile tag toggle stays).
- **C5 Segmented control.** One `Segmented` and FilterChipRow chips; every `aria-pressed` group routed.
- **C6 Chips.** Choice chip (check when on) and read-only tag, square 3px; `.nb-tag` pill → square.
- **C7 Selects.** Styled native select (`nb-select`) everywhere; ui Select only where search is needed.
- **C8 Counters.** "7 / 80" mono, on focus or near the limit, everywhere.
- **C9 Dates.** `DateTimeField` everywhere a date is entered.
- **C10 Tooltips.** Styled tooltip on icon buttons and truncated text; `title` only as fallback.
- **C11 Menus.** One item style; destructive last, red, separated.
- **C12 kbd.** One `Kbd`.
- **C13 Dialogs.** Three sizes (confirm, form, side panel), one enter/exit, one header.
- **C14 Hover cards.** One person card, 400 ms delay, same fields.
- **C15 Drop targets.** One dashed target and dragging state.
- **C16 Tabs.** Cell tab bar (pages) and underline tabs (panels); the 20 hand-made tab lists routed.
- **C17 Counts.** One count chip rule.
- **C18 Optimistic.** Toggles flip at once and roll back with an inline error + Try again.

## Verify and ship
Unit suite, tsc, lint, the full browser suite; a fresh whole-branch review; cherry-pick only this plan's commits (and the My Work header + draw-in) onto origin/main in a worktree; test there; push; watch Railway; check live.
