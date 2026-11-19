# Workflow tabs — implementation plan (every template, one at a time)

## Context
The report `docs/superpowers/plans/2026-11-16-workflow-tabs-report.md` (≈17,300 lines, sections 28–38) designs every workflow, template and org workflow NetworkBase will get. It's too big to build from memory: items get forgotten and end-to-end behaviour checks get skipped. This plan turns the whole report into **147 ordered units**. Each unit is one thing a person can see and try (one template, one meeting type, one view, one org workflow), with its prime goal, what to build, how (design, flow, UI/UX, back end, data), local checks, a design gate, deploy, and the live end-to-end journeys that prove it landed. The user's rule (memory `feedback_workflow_tabs_build_loop`): build one unit → test locally end to end → design gate → **deploy without asking** → check live end to end → only then the next unit; log every unit.

Source of truth for every unit = its report section (cited). When this plan and the report disagree, the report's agreed calls win, except where this plan records a correction found in the code (marked **Correction**).

---

## 1. The loop every unit follows (no exceptions)
1. **Read** the unit's report section(s) again; list its calls. No guessing: anything the report doesn't say is decided in the unit's mini-plan and written into the report as a new call before code.
2. **Mini-plan** (`superpowers:writing-plans`, short): files, migration, functions, tests. Ponytail: reuse the named existing parts first.
3. **Build on local main** (`feedback_implement_trigger_local_main`); test first for SQL/query changes (`superpowers:test-driven-development`); stage **named files only**.
4. **Local checks (real commands):** `npm run test:unit` (node:test via tsx; pure rules + design contract); `DATABASE_URL_FRESH=$(npm run -s db:disposable) npm run test:db` for every SQL/permission rule (transaction rolled back, `tests/db/_helpers.ts`); `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`; `npm run lint`; `npm run check:terminology`; `npm run check:db:migration-journal` and `check:db:migration-sources` when a migration is added; the CI contract checks run **locally before pushing** (CI runs alongside Railway, not before it): `check:rls-contract`, `authz`, `api-versioning`, `api-envelope`, `query-key`, `sql-governance`, `page-contract`, `force-dynamic`, `runtime-boundaries`; a UI spec in `tests/browser` (fixture-driven, added to its `testMatch`) for new surfaces; the unit's **part-8 items** checked explicitly (Overview card, My Work, notifications at their levels, CLI/MCP via `node packages/nb-cli/bin/nb.mjs`); the unit's **journeys** clicked through in the browser pane on the **scratch copy on :3100** (never temp routes in the repo).
5. **Design gate** (section 2) with screenshots: desktop + phone (375 px), light + dark, keyboard path, screen-reader names, compared side by side with the Tasks tab.
6. **Review:** `ponytail-review` then `review` on the unit's diff.
7. **Deploy (no asking):** `git log origin/main..main` must show only this unit's commits (else stop and ask: other sessions share the checkout); migrations are hand-written (`drizzle/NNNN_name.sql` + `drizzle/meta/_journal.json` entry + `src/lib/db/schema/index.ts`) and applied to production **before** the push with `npm run db:setup` (session pooler, not port 6543; postgres URL from `.env.local`); `git pull --rebase`; push to `origin/main` (Railway auto-deploys both services; CI `onboarding-release-gate` and `e2e-pr-gate` run on push); wait for Railway SUCCESS and green CI; Inngest Resync only if a function changed (none planned: clocks and reminders ride the existing hourly `chat/due.wake` job).
8. **Live end-to-end check** in the browser pane on the production site, on test workspaces/orgs named `wt-test-<unit>` with the flag switched on for them only: run every journey; watch Sentry for 15 minutes (`canary`) — the next unit may be **built locally** meanwhile but never pushed until this one is ✓; remove test data after. **Time-based journeys** (hourly breach, 15-minute reminders, midnight pins, 24 h pauses, 7-day windows, 180-day Dormant) are proven by injected-clock tests locally and logged `live-pending` with a revisit date; the revisit is checked off in a later unit's session.
9. **Log** the unit in the ledger (section 7): commit, migration, local ✓, design ✓, live ✓ with date. Update memory.
10. **On any failure:** `investigate` → fix → redeploy → re-run all journeys. The next unit never starts until this one is ✓.

## 2. Design gate (checked on every unit)
- **Shared parts only:** `src/components/workspaces/v2/tasks/form-parts.tsx` (`Field`, `SectionDivider`, `QuickChips`, `SelectWrap`, `FORM_*`), `src/components/ui/UnderlineTabs.tsx`, `src/components/ui/rail-section.tsx` (`RailSection`), `src/components/ui/EmptyState.tsx` (`.nb-empty-state`, one sentence + one action), the task card/panel, F3's `FilterChipRow`, T1's Calendar and Timeline parts. **Status badges:** there are three today (`tasks/badges/TaskStatusBadge.tsx` for task-like items, `organizations/org-ui.tsx` for org states, `files-tab/FilesChrome.tsx` for files) — use the one for the surface's family, never a fourth. No one-off components or colours.
- **Header pattern** for every tab/view: icon + name · mono counts · view switch (UnderlineTabs) · chip row · primary button · ⋯ — same as the Tasks tab.
- **Type and colour:** Instrument Sans text, JetBrains Mono for numbers/dates/counts; design tokens only; precision badge shape (no round pills); colour never the only signal (words + icon); Lucide icons (emoji only for project icons); 180 ms ease-out motion.
- **Words:** `src/lib/copy/terms.ts` (banned terms incl. "Lead") and `docs/design/settings-copy-glossary.md`; "Completed", "Assigned to", NB-n.
- **Matches** the unit's report section (sketch + screen spec) and prototype v4.
- **States:** skeleton, empty (empty-state contract), error with retry, no permission, live update, undo.
- **Contract test** per new surface (pattern of `tests/unit/task-design-contract.test.ts`).
- **Phone and accessibility:** 375 px, 44 px targets, every drag has a menu path, keyboard path, labelled regions.

## 3. Fixed facts and corrections before building
- **Migration numbers:** production is at **0102**; the report's 0101–0111 are renumbered in order from **0103** (table in section 6).
- **Corrections found while planning:** W2's `class_lesson` and S1's `event` are F1 item types (`tasks.item_type`), not new `tasks.kind` values (kind stays `task | assignment`); C2's progress table and O3's `lesson_progress` are one table; undated sprints are built once (A7.6) and reused by C2.
- **Corrections already in the report:** Remove workflow = Hide only (no task Trash, F1 call 4); members' sprint choice → Backlog and the dialog's `canAssignSprint` must allow admins (F3 calls 3–4); learning-path progress uses a `lesson_progress` table, not org assignments (O3); sprint dates become nullable (O3); every file gets `file_comments` (O1).
- **Flags:** Part A sits behind `workspaces.workflows_enabled` (F1) and each catalog entry's `built` flag; Part B behind `workspaces.org_workflows_enabled` (added with B0.1). Live checks switch the flag on for `wt-test-*` workspaces only (one SQL update, logged). When a wave is fully ✓, a **switch-on step** turns it on for everyone (see the decision in section 10).
- **Time-based work** (reminders, clocks, midnight clears, pause expiry, recruiting auto-off, Friday Summary, Mark taught reminder) is always a **step inside the existing hourly `chat/due.wake` job** with exact-time wake events: no new Inngest function, no resync, within the free-tier limit.
- **CLI and MCP** are built and checked per unit with the repo's `node packages/nb-cli/bin/nb.mjs`; the npm release (tag `cli-v*`, publish workflow needs the owner's approval on npm) happens once per wave (section 10).
- **Never:** posting to outside platforms, fetching pasted links, payments, public workflow tabs (B11), agents doing "yes" actions alone.

---

## 4. Part A — Ordinary workspace (98 units, report section 38 + linked category sections)

**Flag rule for Wave 0:** no workflow is `built` until A1.3/A2.1, so A0.2–A0.4 and A0.8 are proven locally with a dev-only "all built" override; live they're proven by "flag off changes nothing" plus the server journeys, and their UI journeys are **re-run live** at A1.3 (F1 W1–W3, W7), A2.4 (F3 W1) and A3.1/A4.1 (F2 W1, W2).

Format per unit: **Goal** · **Build** (data · server · UI) · **Journeys (local and live)**. Rules, words and calls are in the cited report section; the mini-plan copies them.

### A0. Wave 0 — Foundation (11 units) — report 38.2–38.4
**A0.1 Types and stages engine** (38.2 F1)
- Goal: a task can carry a type and a stage; the stage sets status and whether it's on the board.
- Build: migration `tasks.item_type/stage/type_fields/on_board` + index; `workspaces.workflows_enabled`; `src/lib/workflows/types.ts` (registry, F1 stage table) and `rules.ts` (`statusForStage`, `isOnBoard`, `stageMove`, `boardMove`, `defaultStageFor`); `setTaskStageAction` inside `transitionTaskTx`; board reads add `on_board`; sprint events `joined_from_workflow`, `moved_back`; payload fields. No UI yet beyond hidden type support.
- Journeys: existing tasks unchanged on the board; a test-only bug (via server) moves New→Fixing (joins), Fixing→Confirmed (leaves, sprint history "moved back"), Fixing→Blocked keeps stage, done with review on waits for approval. Indexes on `tasks` are built `CONCURRENTLY` in a separate non-transactional migration (added to `NON_TRANSACTIONAL_MIGRATIONS`). `item_type` gets **no SQL CHECK** (validated on the server like `stage`, so Part B types `event`, `poll`, `paper`, `competition` need no ALTER).

**A0.2 Add workflow dialog, tab row, Settings → Workflows** (38.2 F1 S1–S3, S8)
- Goal: owners/admins add and hide workflows; tabs appear after a divider.
- Build: `workspace_workflows` table; `src/lib/workflows/catalog.ts`; `addWorkflowAction`, `undoAddWorkflowAction`, `removeWorkflowAction` (hide only); `effectiveWorkflows`, `canChangeWorkflows`, `removalSummary`; `WorkspaceLayout` TABS gains workflow tabs after a divider + "+ Add workflow" (⋯ on phone); dialog per S2; Remove dialog S3; settings section after "Stages and workflow".
- Journeys: F1 W1, W2, W3 (live tab in a second browser), W7, W10, W11.

**A0.3 Org push + wizard suggestions** (38.2 F1 W8, W9, S9, S10)
- Goal: an organization pushes workflows (locked in children); the wizard suggests the category's top workflow.
- Build: `pushWorkflowAction`/`unpushWorkflowAction`; lock icon + "Added by"; `Phase4Settings` Workflows `LaunchSection`.
- Journeys: F1 W8, W9.

**A0.4 Document sections in the rail** (38.3 F2 S1, S2)
- Goal: Documents shows sections when a document workflow is added; documents can move between sections.
- Build: doc settings `section/kind/date`; section index; `railSections`; `WorkspaceDocRail` headers; `moveDocToSectionAction`.
- Journeys: F2 W1, W2, W11.

**A0.5 Live task-rows block + Insert menu** (38.3 F2 S3, S5, S6)
- Goal: action items/checklists in documents are real tasks; ticking never writes the document.
- Build: migration `tasks.source_doc_id/source_block/source_position`; `doc-live-blocks.ts` (`parseLiveBlocks`, `newBlockKey`, `canAddRows`, `canTickRow`, `orderRows`, `visibleRows`); `addDocRowAction`, `moveDocRowAction`, `detachDocRowAction`; `WorkspaceDocLiveBlock`; `TextViewer` Insert ▾; task page "From" line.
- Journeys: F2 W3 (using an Insert-menu block; the Weekly template arrives in A4.3), W4 (live tick from the board), W5, W7, W8, W9, W10, W12, W13; CLI `nb docs rows`, `nb tasks create --doc --list`; MCP `networkbase_doc_rows`, `networkbase_doc_rows_add`.

**A0.6 Decisions block + D-numbers** (38.3 F2 S4)
- Goal: record decisions from any document with a permanent D-number.
- Build: decision settings + unique index; `recordDecisionAction`; `nextDecisionNumber`.
- Journeys: F2 W6; two parallel records stay unique.

**A0.7 Sprint permission fix** (38.4 F3 call 4) — standalone, ships first in Wave 0 if wanted
- Goal: the create dialog offers Sprint to owners and admins (server already allows, decision 146).
- Build: `TasksTab` passes `canAssignSprint` for owner or admin.
- Journeys: an admin creates a task in a sprint; a member sees "Goes to the Backlog".

**A0.8 New module with type tabs** (38.4 F3 S1, S2)
- Goal: one dialog creates every type, with Starts at and a footer that says where the item shows.
- Build: `CreateTaskModal` gains type tabs (`moduleTabs`), Starts at (`startingStages`, `defaultStartingStage`), footer (`footerLine`), carry-over (`carryOnSwitch`), sections (`sectionsFor`); `createTaskAction` validates type, stage, `typeFields`; member sprint → Backlog; New ▾ split button.
- Journeys: F3 W1–W4, W8, W9 (phone), W10; `CreateSprintModal` checked against the same shell (28.11 gap).

**A0.9 Quick add + More details** (38.4 F3 S3)
- Journeys: F3 W5 (from a document row and an own-tab list).

**A0.10 Item panel: type section, Shows in, Stage menu** (38.4 F3 S4; 38.2 S7)
- Build: `TaskDetailPanel` header row 2; `DetailsTab` type section; `updateTaskTypeFieldsAction`; Work tab slot for never-on-board types; F1 **S4 Join-board sheet** (sprint tick remembered 24 h per person, members "Goes to the Backlog") and **S5 type marks** on cards (incl. greyed hidden-workflow mark); CLI `nb tasks list/create/move --type --stage`, `nb workflows`; MCP `type`/`stage` on list/create/move + `networkbase_workflow_list`.
- Journeys: F3 W6; F1 W4, W5, W12.

**A0.11 Filter chip row + Type filter** (38.4 F3 S5; 38.2 S6)
- Build: `FilterChipRow` shared part; URL params (`filtersFromUrl/ToUrl`); Tasks gets Assigned to · Type · Due · + Filter.
- Journeys: F3 W7; a copied link reopens the same filtered view; phone Filters sheet.

### A1. Wave 1 — Tasks views (6 units) — 38.5 T1
**A1.1 Calendar view** — Goal: every workspace sees items on their due days. Build: Tasks view switch (Board · Calendar · Matrix), shared Calendar part (`calendarCells`), `readCalendarAction`, No date tray, drag sets due. Spans wait for `start_date` (A1.3 adds them). Journeys: T1 W8 (due day only), W10 (agenda), time-zone check.
**A1.2 Matrix view** — Goal: personal 2×2 by priority and due. Build: `matrixBox`; moves change priority/due; Assign…, Move to Backlog. Journeys: T1 W9.
**A1.3 Project type + Part of + Work tab** — Goal: projects group work tasks. Build: migration `tasks.start_date`, `tasks.part_of_id`; project type/stages; `setPartOfAction`, `groupIntoProjectAction`, `completeProjectAction`; `completion`; Projects view entry; panel Work tab. Journeys: T1 W1, W3, W5.
**A1.4 Projects → Timeline** — Build: Timeline part (`timelineRange`, `barGeometry`, `conflicts`, `dependentsToShift`), drawing + S6 quick-create bubble, `setTaskDatesAction`, `shiftDependentsAction`, arrows via `updateTaskMeta` loop check, Show sprints; Calendar spans switched on. Journeys: T1 W2, W4.
**A1.5 Projects → Active and All + Overview card + My Work + CLI/MCP** — Journeys: T1 W6, W11, W12, Overview card, "Ends Friday" in My Work, `nb tasks --type project --part-of`.
**A1.6 Board grouped by project** — Journeys: T1 W7.

### A2. Wave 2 — Same-data tabs (11 units) — 38.6–38.9
**A2.1 Bugs: tab, report, triage** (38.6) — Goal: sort bug reports before work. Build: catalog entry; Bugs tab (Triage · Board · Mine · Fixed), severity strip; Bug details section; `similarBugsAction`, `seeTooAction`, `confirmBugAction`; Overview card. Journeys: T3 W1–W4, W7, W8, W11, W12, W13 (phone); workflow-tab **unread counts** (first stage only, 28.4) built here for every own tab.
**A2.2 Bugs: close, duplicate, can't reproduce, reopen** — Build: `closeBugAction`, `reopenBugAction`, `resolveDuplicateTarget`, `mergeOnDuplicate`. Journeys: T3 W5, W6, W9.
**A2.3 Bugs: chat + Change type + CLI/MCP** — Build: `reportBugFromMessageAction`, `changeTaskTypeAction`, `nb bugs`, `networkbase_bug_report/close`. Journeys: T3 W10, W14, W15.
**A2.4 Requests: types, ask, Inbox** (38.7) — Build: migration `workspace_request_types`; starters; ask form; `acceptRequestAction`, `declineRequestAction`; Inbox · Board · Mine · My asks. Journeys: T4 W1–W4, W8, W9, W11.
**A2.5 Requests: working hours + clock + Breaching soon** — Build: `workspaces.working_hours`; `workingMinutesBetween`, `addWorkingMinutes`, `clockState`, `reminderTimes`; clock reminders as `task_reminders` rows on the hourly job. Journeys: T4 W7, W10; breach notice after the hour.
**A2.6 Requests: waiting, review, delivered, solved + Overview card** — Journeys: T4 W5, W6, W12, W13; S9 Overview card.
**A2.7 Content: tab, channels, ideas, calendar** (38.8) — Build: migration `workspaces.content_settings`; Calendar with Ideas rail; quick-adds; This week; Board; To schedule. Journeys: T5 W1–W4, W10, W11.
**A2.8 Content: draft, edit, publish** — Build: `writeDraftAction`, `readyForEditAction` (review queue), `markPublishedAction` (never fetches), publish reminder. Journeys: T5 W5–W7, W9.
**A2.9 Content: results + Performance** — Journeys: T5 W8, W12.
**A2.10 Roadmap: tab, Now/Next/Later, work, auto stage** (38.9) — "Ships in" hidden until launches exist. Journeys: T2 W1–W5, W7, W11, W12 (W6 re-run at A3.1).
**A2.11 Roadmap: Timeline, Backlog, milestones** — Journeys: T2 W8 (launch diamonds re-run at A3.1), W9, W10.

### A3. Launches (8 units) — 38.10 D2
**A3.1 Launch document core** — Goal: a launch is a document whose steps are tasks. Build: `createLaunchAction`, launch header, stage blocks, Ships block, What's new, `launchAction`, `closeLaunchAction`, `moveLaunchDateAction`, `cancelLaunchAction`; preset loader from `templates/launches/*.md`. Journeys: D2 W1–W10 with the Blank preset; re-run T2 W6 and W8 (Ships in, diamonds).
**A3.2–A3.8 One preset each** — Goal of each: the preset's stages and default steps land exactly as its source section says. Per preset: write `templates/launches/<id>.md` (headings + one task-rows block per stage + default steps JSON); journey = new launch from that preset → steps appear unassigned/undated in the right stages → launch → close.

| Unit | Preset | Stages (source) |
|---|---|---|
| A3.2 | Product launch | Market research · Goal identification · Marketing plan · Sales and support training · Testing and beta testing · Launch day · After launch (11.5) |
| A3.3 | Feature release | Build done · QA · Docs · Announce · Watch (11.5) |
| A3.4 | App release | Build and test · Store listing · Privacy · Submit for review · Release · After release (20.4) |
| A3.5 | Store launch | 3+ months before · 1 month before · Launch week · After launch (22.4) |
| A3.6 | Digital product launch | Make · Listing · Launch · After (25.5) |
| A3.7 | Content launch | Script · Record · Edit · Publish · Promote (11.5) |
| A3.8 | Blank | Checklist (11.5) |

### A4. Meetings and decisions (16 units) — 38.11 D1
**A4.1 Meetings core** — Goal: dated meeting documents with attendees, series, reminders, Finish with carry-over. Build: migration `workspace_meeting_series`, `workspace_document_reminders` (fired by the hourly job); `createMeetingAction`, `finishMeetingAction`, series actions; Meetings calendar; Open action items; .ics feed. Also: Overview card ("Next: Weekly · Thu 10:00 · 4 open action items"), My Work today's meetings, the D1 notifications table. Journeys: D1 W1, W3, W5, W8–W12 with the Blank type.
**A4.2 Decisions: ADR shape, supersede, reverse** — Journeys: D1 W4, W7.
**A4.3–A4.15 One meeting type each** — Goal of each: the type's body lands as the report lists and works with action items/decisions. Per type: `templates/meetings/<id>.md`; journey = new meeting of that type → fill → add an action item → finish.

| Unit | Type | Body / extra (D1 W2) |
|---|---|---|
| A4.3 | Weekly / Team | Agenda · Notes · Decisions · Action items |
| A4.4 | Standup | One heading per attendee: Yesterday · Today · Blockers |
| A4.5 | Planning | Goal · What's in · What's out · Action items (link a sprint) |
| A4.6 | Retrospective | Went well · Needs improvement · Ideas · Action items |
| A4.7 | Kickoff | Why · Scope · People · Dates · Risks · Action items |
| A4.8 | Client | Agenda · Notes · Next steps |
| A4.9 | Board meeting | Motions (`addMotionAction`, `recordVoteAction`), quorum, Approve last minutes (lock) — D1 W6 |
| A4.10 | Recording session | Tech checklist · Prep questions · Timings |
| A4.11 | Shoot day | Call time · Location · Crew and cast · Equipment · Shots · Weather; prints as a call sheet |
| A4.12 | User interview | Consent to record (required) · Goal · Questions · Notes · Insights; **Save as idea** hidden until Ideas is added (A5.3 adds it and re-runs this journey) |
| A4.13 | Incident review | Linked bug · Timeline · Root cause · Actions · Lessons |
| A4.14 | Playtest | Build · Tester · What I saw · Fun · Confusion · Bugs with Report as bug · Ideas |
| A4.15 | Blank | Notes (built in A4.1; unit = final check) |

**A4.16 Settings → Meetings** (types on/off by category, length, reminder minutes; stored in `workspaces.workflow_settings`, created in the first migration) — Journeys: switching a type off hides it from New meeting.

### A5. Goals, Ideas, Off-site (4 units) — 38.12–38.14
**A5.1 Goals document + objectives + key results + check-ins** — Build: migration `key_result_check_ins` + `workspaces.workflow_settings`; goals block; `checkInAction`; pace (`krProgress`, `expectedPace`, `status`); check-in reminders via the hourly job. Journeys: D3 W1–W5, W7, W9, W10.
**A5.2 Close period + carry forward** — Journeys: D3 W6 (W8 Contributes to moves to B4.3, which needs org objectives).
**A5.3 Ideas ranked block + Start building** — Journeys: D4 W1–W9; switch on User interview's Save as idea and re-run A4.12.
**A5.4 Team off-site** — Journeys: D5 W1–W7.

### A6. Document templates, Docs site, Snippets (35 units) — 38.15 D6
**A6.1 Start from mechanism** — Goal: New document offers NetworkBase templates by group. Build: `templates/docs/*.md` loader with front-matter (group, section, kind, description); `createDocFromTemplateAction`; AddDocDialog "Start from"; `workflow_settings.docs` groups shown; parked-tab placeholders ("Available when Money is added"). Journeys: D6 W1 with one template.

**A6.2–A6.33 One template each.** Goal of each: the template's headings, guidance and live blocks exactly as its source section; it opens from Start from with the right section; every live block works; parked parts show the placeholder. Per template: write the `.md` from the source section (headings verbatim from the report), journey = Start from → title → document opens → fill one block → render check (desktop + phone).

| Unit | Template | Source | Special |
|---|---|---|---|
| A6.2 | Assumptions check | 11.8 | — |
| A6.3 | Value proposition | 11.8 | — |
| A6.4 | Business model canvas | 11.8 | renders as 3×3 from headings |
| A6.5 | Investor update | 11.8 | goals block (needs A5.1) |
| A6.6 | Business plan | 20.7 | — |
| A6.7 | Client report | 12.5 | time/money placeholders (Money parked) |
| A6.8 | Creative brief | 24.7 | — |
| A6.9 | Brand questionnaire | 24.7 | — |
| A6.10 | Case study | 24.7 | — |
| A6.11 | Brand guide | 14.7 | colors placeholder until A7.3, re-checked there |
| A6.12 | Tech spec | 13.4 | Request review |
| A6.13 | API docs | 13.5 | — |
| A6.14 | PRD | 20.2 | links roadmap items (A2.10) |
| A6.15 | FAQ | 20.3 | folding questions |
| A6.16 | Persona | 20.6 | — |
| A6.17 | Postmortem | 21.2 | links a bug (A2.1) |
| A6.18 | Test plan | 21.5 | `testPlanSummary`, Report a bug on Fail rows |
| A6.19 | Blog post | 14.4 | re-check T5 Write draft uses it |
| A6.20 | Newsletter | 14.5 | re-check T5 Write draft uses it |
| A6.21 | Content brief | 14.6 | — |
| A6.22 | Show notes | 18.7 | — |
| A6.23 | Episode run sheet | 18.7 | — |
| A6.24 | Sponsor read | 18.7 | — |
| A6.25 | Video script | 19.7 | — |
| A6.26 | Beat sheet | 19.7 | — |
| A6.27 | Short film script | 19.7 | — |
| A6.28 | Call sheet | 19.4 | print layout |
| A6.29 | Class notes | 15.3 | learner notes private by default |
| A6.30 | Grant proposal | 17.7 | money/readiness placeholders |
| A6.31 | Impact report | 17.7 | goals block; money/donors placeholders |
| A6.32 | Game design document | 22.2 | — |
| A6.33 | Character profile | 24.4 | gallery section |

**A6.34 Docs site view** — Build: `setDocsSiteAction`, `searchDocsAction` (⌘K). Journeys: D6 W3, W4 (public shows only switched-on docs). **A6.35 Snippets** — Journeys: D6 W5, W6 (`nb docs new --template`, `nb snippets`, `networkbase_doc_create` template, `networkbase_snippet_get`).
(Count note: A6 = 1 mechanism + 32 templates + 2 views = 35; Part A totals 98.)

### A7. Files, Updates, Sprints (7 units) — 38.16–38.18
**A7.1 Assets gallery + details + Used in** (O1) · **A7.2 File comments: pins and moments** (O1, migration `file_comments`) · **A7.3 Colors + outside links + new-version notices** (O1) · **A7.4 Scheduled Updates** (O2, migration `workspace_scheduled_updates`, hourly job step; adds T5's auto-publish hook via `source_task_id` and re-runs T5 W7 for a NetworkBase channel) · **A7.5 Changelog** (O2, `parseRelease`) · **A7.6 Undated sprints + Path view (steps and lessons only)** (O3, migration sprint dates nullable + `path_position`; audit every sprint-date read first) · **A7.7 Lesson progress + Progress table + public path + `nb path` + My Work "Up next"** (O3, `lesson_progress`). Journeys: the round's W-lists.

---

## 5. Part B — Organizations (report sections 29–37)

Every organization unit waits for **B0 (three levels, 29.2)** and Wave 0 (A0). Order inside each type follows its "whole picture" build order. Format per unit: **Goal** · **Build** (data · server · UI, from the section's "New stored things" and calls) · **Depends** · **Journeys (local + live)** taken from the section's flows and its layer-18 checks.

### B0. The organization levels (2 units) — section 29
**B0.1 Institution level (29.2)**
- Goal: an organization can sit under an institution/company/community (three levels); a class or team can **Join** a parent later.
- Build: an org whose `parentId` points to an org (no new table); read permissions gain a grandparent (`app_private.nb_project_can_read`, viewer's parent-org role) — **test first**; sidebar and profile nest three deep; `verified_against` "Part of …" becomes a link; "Set by <parent>" locked rows for pushed settings (terms, AI policy, late rule, privacy cap); institution admins see counts/states only, never student work.
- Journeys: create institution → create class under it → class shows "Part of"; an institution admin opens a class: counts only, no hand-ins (server test); a standalone class joins a school; sidebar three deep on desktop and phone.
**B0.2 Department label + Head of department; institution tabs (29.5)**
- Build: Department label on classes; Head of department role scoped to it; institution Overview (classes needing attention), About (programs, departments, public classes), Tasks (pushes assignment templates/policies, never assigns), Review queue counts, Projects (classes by term/department/teacher, Start next term, bulk archive), Members (staff/student directory, CSV import), Settings (year, terms, defaults, template library, privacy cap).
- Journeys: head of department sees only their department's classes. (Start next term's plan copy is checked in B1.2, which builds the Term plan.)

### B1. College / University (8 units) — section 30, order W1, W2, W8, W6, W7, W4, W3, W5
**B1.1 W1 Class home (30.2)** — Goal: class details, syllabus card, This term, Next class. Build: class details in `org_settings` (no table); sessions = meets × term − breaks (pure function, stored only when changed); Syllabus template; Cancel/Move this class; Tell the class tick (off). Journeys: set details → visitor vs member view; cancel a session → Next class updates and class notified; Tell the class posts exactly one announcement; session unit tests (time zones, breaks, moved).
**B1.2 W2 Term plan + lessons (30.3)** — Goal: units → weeks → lessons table with outcomes and progress. Build: also the Sprints Calendar for classes, the Term plan block in the Syllabus, Behind plan (head of department, institution), Required before-class reading, duplicate a lesson/unit, institution template + required outcomes, the Mark taught reminder (Summary, once a day, as an hourly-job step); TA limits applied when B1.3 lands; **Correction:** lessons are F1 `item_type = 'class_lesson'` (never on board), not a new `tasks.kind`; stages Planned → Ready → Taught (Cancelled); outcomes in `org_settings`; Term plan view in Sprints; lesson ↔ session matching; Needs a new session; Shift the rest; Settings → Term plan. Journeys: plan a week → Ready (students see Before class) → Mark taught; cancel a session → lesson "Needs a new session", nothing moves; teacher notes never reach students (server test); Start next term re-dates.
**B1.3 W8 Sections and TAs (30.9)** — Build: section table + membership (one per student per kind); Split students; Sections assignment target; review routing to section TA; Rebalance; section audience. Journeys: split 60 students into 3 → assignment to Sections → copies route to TAs; move a student → unmarked copies follow; TA sees only their section's work (server test).
**B1.4 W6 Attendance (30.7)** — Build: attendance table (session × student → Present/Late/Absent/Excused, note, by, at); Take attendance sheet (Mark all present); optional 4-digit check-in code (10 min); 7-day edit window; "you can miss N more"; institution minimum (locked); register CSV. Journeys: take attendance on phone; code check-in once per account; edit after 7 days only by Teacher and logged; institution sees counts only (server test).
**B1.5 W7 Marks and rubric (30.8)** — Build: marking setting on assignment master; Rubric record frozen on publish; marks table (total, per-criterion, comments, marker, second mark); comment bank; team mark + Adjust for one person; peer review (names hidden); Marking panel (keys 1–4). Journeys: mark with rubric → Approve → student sees after release; Return keeps hidden draft; agents refused when writing marks (server test).
**B1.6 W4 Exams (30.5)** — Build: assignment `type: exam` settings (format, window, room, covers, out of, second marker, hold); extra time per student; server-locked paper; clash check (warn); Make-up for…; second marking (10 % sample, Needs agreement > 10 %); Release results; institution Exams view. Journeys: timed paper never sent before opening (server test); extra time moves only that student's close; held results hidden until Release.
**B1.7 W3 Student's week (30.4)** — Build: Week view in My work; Pin for today (≤ 3, cleared at midnight); exam strip; teaching rows. Journeys: rows clear on hand-in/excuse; pins clear at the person's midnight; a teacher never sees students' personal tasks (server test).
**B1.8 W5 Thesis workspace (30.6)** — Build: Thesis template; chapter settings + word counts (excluding code/comments/references); Literature record list + BibTeX in browser; Supervision meeting type (D1); Supervisor label; outputs (become R2 `paper` later); coordinator table (numbers, not text). Journeys: hand in milestone with chapters (frozen); review goes to that supervisor; coordinator can't read thesis text unless supervisor (server test); BibTeX round trip.

### B2. Coaching / Bootcamp (5 units) — section 31, order C1, C2, C5, C3, C4 (after B1.1, B1.2, B1.3)
**B2.1 C1 Cohorts and programs (31.2)** — Build: Program snapshot in the template library; cohort ↔ program link; Start a cohort (`duplicateOrg`, dates shifted, no learners/marks/attendance); Update from a cohort; completion rule → verified profile entry; Move to a later cohort; institution kind Coaching/Bootcamp starting values. Journeys: start cohort from program → no learner data copied (server test); running cohorts don't change on update; completion cases.
**B2.2 C2 Learning path (31.3)** — Build: Pacing per class (never mixed); undated sprints (**shared with A7.6**); progress = the same `lesson_progress` table as O3 (**Correction: one table for both**); copies made on module open with relative due; lock in order setting; pace On/Behind; public outline. Journeys: learner Continue → Mark done → next; % never lowered by new steps; undated sprints never auto-start; agents can't mark done (server test).
**B2.3 C5 Mentors (31.5)** — Build: Mentor group section kind; Check-in meeting type (one running doc per pair); objectives ≤ 3; time slots + .ics; Useful answers (shown after 5); concerns; Mentor only role. Journeys: match → kickoff → prep → check-in → actions become tasks; notes never reach staff unless shared (server test); Useful hidden under 5.
**B2.4 C3 Mock tests and skills (31.4)** — Build: Score layouts (sections, maxima, scheme, conversion, overall rule); series label; per-section marks with W7 mark; targets; My exam; mistakes (private); syllabus stages; My prep; Scores grid in bands. Journeys: enter marks → release → Latest/Best/trend (no averages); a learner never sees another's scores (server test); Missing never zero.
**B2.5 C4 Capstone and demo day (31.6)** — Build: Capstone template; brief; showcase card (Draft → Ready); run of show; Judge role (feedback, not marks); awards; Demo days archive; Take the workspace. Journeys: teams lock on date → workspaces created → Final milestone → card Ready → public only when all agree (server test) → judges see only their demo day.

### B3. School K–12, staff-only (5 units) — section 32, order S1 → S5
**B3.1 S1 School year and calendar (32.2)** — Build: terms as school sprints shown in teams ("Set by"); day types table; `event` as an F1 item type (never on board) with type, audience, place, owner, status, checklist; repeat rules skipping non-school days; Start next year by term week; personal + public .ics; Friday Summary. Journeys: enter the year → repeats skip holidays → term change warns, moves nothing; public feed holds only public items (server test).
**B3.2 S2 Curriculum map and lesson plans (32.3)** — Build: course template; Year map view; lesson type (Lesson/Assessment/Activity); Taught per lesson × class; class notes; standards CSV; Behind the map. Journeys: per-class Taught; Start next year without ticks/notes; public overview titles only (server test).
**B3.3 S3 Staff hand-ins and reviews (32.4)** — Build: NB-item hand-in type (frozen version); second approver ("Then approved by", max 2); repeat by school week; quiet weeks + clash check (warns); I've read this sign-off; hand-in template library; "Overdue" wording. Journeys: hand in a unit (frozen) → first approve → second approve → lessons Ready; leaders see counts only (server test).
**B3.4 S4 Timetable, cover, duties (32.5)** — Build: day patterns, periods, rooms; classes as names; timetable slots (CSV/typed + today-only changes); absences by period on `org_member_away`; cover suggestions; cover info; Cover only role; duties + swaps; Your day, My timetable. Journeys: report absence → suggestions never offer busy staff → manager picks → cover lesson opens plan + note; absence reasons private (server test).
**B3.5 S5 Staff meetings and growth (32.6)** — Build: school meeting types (D1); Reports to label; goals ≤ 3 (D3 objectives); year review template (no ratings); observations (feedback, notice, "Just between us"); development log. Journeys: growth records reach only person + line manager (server test); no score fields anywhere.

### B4. Company (5 units) — section 33, order K1, K2, K3, K4, K5 (K4's "request a team" step stays hidden until K5, then K4 W-journeys re-run)
**B4.1 K1 Company home and handbook (33.2)** — Build: Handbook starter sections; page owner + Review by; Process (SOP) template + Run this process; About relabels + Values + Offices; Company-wide flag; pinned announcements (7 days); Docs site view (A6.34) for the Handbook. Journeys: change a policy → re-read counts restart; Needs review appears on date; Run this process copies steps.
**B4.2 K2 Directory and org chart (33.3)** — Build: time zone + working hours on company membership; time-off type on Away; Directory, Org chart (indented tree from Reports to, loops refused), Who's out, Counts. Journeys: email never in directory (server test); loop refused; Away excuses hand-ins.
**B4.3 K3 Company goals and projects (33.4)** — Depends: D3 (A5.1); includes D3 W8 Contributes to. Build: company periods; Supports on workspaces; workspace start/end dates; Status Updates; Projects → Goals and Timeline views; private-project mask. Journeys: progress only from key results; private projects masked (server test).
**B4.5 K5 Requests to central teams (33.6)** — Depends: T4 (A2.4–A2.6), K4 (B4.4). Build: Take requests from the company; private types (read rules in SQL); Ask a team + ? Ask; handbook answers shown first (nothing blocked); Asking for; My asks; Merge; Turn into a handbook page; team Counts (Solved shown after 10 answers); "Requester left"; the 33.6 notification levels. Journeys: private request reaches only allowed groups (server test); No reopens; closed teams refuse; re-run K4's request step.
**B4.4 K4 New hire onboarding (33.5)** — Build: New people assignment target with day offsets; start date on invites/memberships; early access (Start here, Handbook, Directory only); buddy label; How's it going?; Leaving plan (off). Journeys: existing members never get steps; start-date change moves open steps; early access sees only three pages (server test).

### B5. Community (5 units) — section 34, order M1 → M2 → M3 → M4 → M5
**B5.1 M1 Community home, Code of conduct, joining** (34.2)
- Goal: About is the public front door, Overview the members' home; joining needs agreement to a versioned Code of conduct with numbered rules.
- Build: agreement record (member, version, date); up to 3 join questions + answers on membership + "Show on my card"; Getting started items (≤ 5, 14 days); welcome-post and first-day DM-limit settings; numbered rules referenced by reports and moderator actions; Settings → Joining; About front-door layout; Where to talk.
- Journeys: join with agreement → Getting started; approval-mode answers to organisers; publish a new rules version → reading continues, posting waits until agreed; report names a rule; a first-day member can't start a new DM but can reply; the member list never shows to visitors. Server tests: no join without agreeing; posting blocked until new agreement.

**B5.2 M2 Members and roles** (34.3)
- Goal: a members-only Directory; organisers' People and Roles; Moderators with limited powers.
- Build: "Show me in the directory"; derived contribution counts (hideable); member status New/Active/Quiet (pure function, organisers only); Moderator grant in `permissions.ts` (hide, pause posting 24 h/7 d with a rule, pass on; never remove/block/settings); Host and Helper labels; Pause posting; moderator activity log; Settings → Members.
- Journeys: search by interest → card → Message; give Moderator → moderate a report (Hide, Pause, Pass on) → logged with rule → member sees pause notice with Appeal; pause ends on time. Server tests: moderators can't remove/block/change settings; status never reaches members.

**B5.3 M3 Events and meetups** (34.4) — Depends: S1 event item (B3).
- Goal: events with Going/Can't go, a place limit, a waitlist, host check-in and a call for talks.
- Build: the **Optional assignment** and its `copyState` rule move here from M4 (Call for talks needs them); reminders the day before and 1 h before (hourly-job steps); the "events attended" count for M2; event fields (format, hosts, who can come, place limit, public toggle, run of show); RSVP records (incl. private RSVP); waitlist move-up; online link visible only to Going; host check-in; Call for talks as an optional assignment reviewed in the Review queue; Events in Sprints (Upcoming · Calendar · Past), event page, host view, My events.
- Journeys: publish event → RSVP to full → waitlist → someone cancels → next moves up (notified); online link hidden from non-Going (server test); visitor must join before RSVP; propose talk → Accept → appears in run of show; cancel event → Important notice to Going.

**B5.4 M4 Rituals, challenges, showcases** (34.5) — Depends: A7.4 scheduled Updates, C4 Showcase card (B2.5).
- Goal: optional challenges, Featured picks, a consent-based public Showcase, and rituals (Thread/Event, AMA).
- Build: (Optional assignment already built in B5.3) prompts with Opens on (server-hidden); entries with cover; Featured + "Why we love it"; public tick per maker (all members for teams); rituals (scheduled Update posted as the community, host named); AMA window; Season recap; Showcase on About.
- Journeys: start challenge → join → prompt opens on its date → hand in → feature → close; public Showcase only after the tick; Showcase never sorts by likes; Thread ritual posts on schedule and stops when Paused. Unit test on `copyState` for optional copies.

**B5.5 M5 Chapters and small groups** (34.6) — Depends: B0.
- Goal: chapters as orgs under the community from a Chapter kit with locked rules; small groups as joinable workspaces with Polls.
- Build: chapter kind (Local/Topic); proposals; Chapter kit (C1 snapshot); locked "Set by" rules; join requires community membership; report chain chapter → community → NetworkBase; Needs a co-organiser / Dormant (180 d) flags; small groups (kind, cap 12, Open/Ask/Invite only); Poll item; chapter health counts.
- Journeys: propose → approve → chapter from kit; a chapter can't loosen a locked rule (server test); joining a chapter without community membership refused; group content hidden from outside organisers; poll → pick → meeting made; Dormant never closes.

### B6. Research (5 units) — section 35, order R1 → R4 → R2 → R3 → R5
**B6.1 R1 Lab home, guide, people** (35.2)
- Goal: Overview is the lab home and About the public lab page; positions separate from roles; lab guide; New people and Leaving plans; opt-in alumni.
- Build: position label + start year on membership; lab guide starter (K1 sections; safety pages Required reading); lab steps in K4 plans; membership ending "Finished"; alumni entry (opt-in, Now at); About section toggles; office hours; Settings → Lab.
- Journeys: accept member with position and supervisor → Start here; Finish in the lab → Leaving plan → alumni ask → listed only with yes; alumni lose private access unless kept as Viewer; positions never change permissions (server test).

**B6.2 R4 Lab notebook, protocols, equipment** (35.5)
- Goal: approved protocol versions, locked notebook entries with amendments, experiments, training, equipment booking.
- Build: protocol versions Draft → Approved → Retired; Run this protocol → entry with version; lock at end of day + amendments; experiments; training sign-off; equipment records, booking on C5 slots (weekly cap), problem reports, maintenance repeats; Data management plan template.
- Journeys: approve v1 → run → entry locks → amend; v2 draft while v1 usable; untrained booking refused (server test); no overlapping bookings; report problem → Out of order pauses booking.

**B6.3 R2 Papers and publications** (35.3) — Depends: W5 (B1.8), S3 frozen hand-in (B3.3).
- Goal: a `paper` item per workspace, a lab Papers view, author confirmation, internal review, submission history.
- Build: type `paper` (six kinds, stages Idea → Published, Rejected, Withdrawn); ordered authors incl. outside names; confirmations; internal review = frozen draft in the Review queue; deadlines; submission history; Reviews and response template; private flag; BibTeX import; Add to my profile.
- Journeys: idea → drafting → confirm authors → internal review → submitted → revising → published; Submitted refused until every member author confirms (server test); unpublished titles never reach About (server test); rejection returns to Drafting with history.

**B6.4 R3 Library and reading group** (35.4) — Depends: W5 Literature, D1 series (A4.1).
- Goal: one lab library with shared notes, private reading states, themes, screening, and a rotating reading group.
- Build: lab-level Source record (thesis lists link, dedupe by DOI/title in browser); lab notes; private reading states and notes; themes + Disagrees; screening states; Reading group meeting type with rotation (skips Away, swaps need a yes); RIS import.
- Journeys: paste BibTeX twice → "Already in the library"; reading states private (server test); rotation picks next presenter, skips Away; pick by deadline → Read before notice; screening counts match rows.

**B6.5 R5 Lab meetings and progress reviews** (35.6)
- Goal: lab meeting with updates round and rotating talk; private supervision; milestones per position; annual review without ratings; IDP; concern routing.
- Build: Lab meeting type (Coming up from R2/R3/R4); update blocks; supervision via C5 Check-in; milestone templates (PhD/Master's offsets, part-time doubling); Progress report flow; Committee label on Viewers; IDP; concern routing; PI counts card.
- Journeys: updates box opens 2 days before → meeting → next made; supervision notes private to pair (server test); milestones move with approved Away; committee access ends on agreement; concern about the PI never routed to the PI.

### B7. Club (4 units) — section 36, order L1 → L2 → L3 → L4 (after B5.1–B5.5 and B6.1: L2 reuses Poll and positions)
**B7.1 L1 Club home and recruitment** (36.2)
- Goal: club page leading with Join, members' home, a self-expiring recruiting period with a printable poster (no QR), Season renewal without auto-removal.
- Build: About section toggles; recruiting period + Discover filter; poster print page; Season renewal settings and answers; bulk "End memberships not renewed" (Season ended, officers excluded); drive counts.
- Journeys: set recruiting dates → banner shows → turns off at end; print poster shows current code; renewal ask → no one removed without officer action (server test); officers never in bulk end.

**B7.2 L2 Officers, committees, handover** (36.3)
- Goal: positions with Season terms and role pages, committees, secret-ballot elections, a dated handover.
- Build: position terms and how filled; role pages (no passwords); Committee section kind with its channel and Join Open/Ask; the Handover meeting type (D1); open tasks move to the incoming officer; one vote per member per position; a candidate can't be returning officer; elections (nominations, statements, voting, results, run-off); ballots stored without voter + separate voted record; returning officer; handover checklist + date switch; committee history.
- Journeys: run an election → results → run-off on tie; a ballot can never be joined to a voter (server storage test); handover date switches roles and removes Coordinator from outgoing; presidency via ownership transfer.

**B7.3 L3 Meetings, minutes, votes** (36.4)
- Goal: General, Committee and AGM meetings with agenda requests, officers-only drafts, quorum, motions and a constitution.
- Build: three meeting types; agenda requests; draft visibility → approved and locked; motions (room counts; online via L2 ballot); quorum from Staying this Season vs attendance; Constitution document with articles, versions by motion, threshold; Decisions by Season.
- Journeys: member proposes agenda item → accepted; not quorate → motion can't pass (server test); drafts never reach members (server test); constitution change only via motion at threshold.

**B7.4 L4 Competitions and teams** (36.5) — Depends: C4 (B2.5), M4 (B5.4).
- Goal: competitions list, team workspaces, fair picking, checks, typed registration, confirmed results, debriefs.
- Build: type `competition`; team template; sign-up, tryouts (optional assignment), picked; checks as each-child assignments; Practice type; registration reference; results confirmed by an officer; Past entries with debriefs.
- Journeys: competition → tryouts → Selected (private outcome, server test) → team workspace → check reviewed → registered → result confirmed → Showcase only when all agree; two teams can't see each other's workspaces.

### B8. Other (4 units + kits) — section 37, order X2 → X3 → X4 → X1
**B8.1 X2 Volunteers and shifts** (37.3) — Depends: S1 event item, M3 RSVP slice, R4 training.
- Goal: org-level volunteer roles and shifts with Regulars, swaps, check-in, confirmed hours, coverage.
- Build: roles (+ training); shifts (RSVP slice + waitlist); Regulars; swaps; check-in window; hours + confirmation; availability; involvement (coordinators only); volunteer agreement (M1); Volunteer with us on About.
- Journeys: join → agreement → sign up → check in → hours; a volunteer sees only their own hours (server test); untrained can't sign up; short 2 days before → coordinator Ask.

**B8.2 X3 Teams for a fixed time** (37.4)
- Goal: key and end dates, backwards plan, bookings, Day of, wrap-up, Close, Run it again.
- Build: org key/end dates; plan starters with offsets (18.2 rule); workstreams (W8 sections); Booking and Issue labels; wrap-up checklist + Close prompt (built `archiveOrg`); Run it again (built `duplicateOrg` + `shiftBy`, debrief pinned).
- Journeys: move key date → offset items move, hand-set don't; team never auto-archives; Run it again copies no members/work and pins the debrief; closed child shows Closed in the parent.

**B8.3 X4 Programs and impact** (37.5) — Depends: D3 (A5.1), K3 (B4.3).
- Goal: programs with a brief and ≤ 5 confirmed measures; stories with consent; an impact report without Money.
- Build: Program workspace mark; brief template; measures as key results (hours, sessions, typed); confirmation with history; Mission and values; Story updates with consent; impact report.
- Journeys: typed number → Confirm → appears in report/About only after (server test); story without consent can't publish; hours equal X2 confirmed hours.

**B8.4 X1 Start from a kit** (37.2) + **B8.5–B8.10 one kit each** (Nonprofit · Event team · Association or committee · Public-sector team · Faith or interest community · Blank)
- Goal: an Other org starts from a kit of already-built workflows; parts can be added or turned off later with data kept.
- Build: kits as data beside `type-profile.ts`; word-list suggestion in the browser; kit step + preview in the wizard; Settings → Workflows Add from a kit / Turn off.
- Per kit unit: switch that kit on only when all its parts are built (contract test checks each part exists); journey = create an Other org named for the kit → kit suggested → create → its tabs and Getting started appear.

---

## 6. Setup before the first unit (P0, one time)
1. Commit the report itself (it has never been committed): `docs/superpowers/plans/2026-11-16-workflow-tabs-report.md`, named file only.
2. Copy this plan into the repo as `docs/superpowers/plans/2026-11-18-workflow-tabs-implementation.md`.
3. Create the ledger `docs/superpowers/plans/2026-11-18-workflow-tabs-ledger.json` with the existing row shape (`key`, `section`, `text`, `kind`, `milestone`, `status`, `test`, `evidence`) plus status `live-pending`; **one row per unit, per W-journey and per [call]** (keys like `38.2.W12`, `38.2.call4`, `30.3.W1`), so a missed journey or call is caught by a check. A **separate script** `scripts/plan/workflow-ledger.ts` (`sync` from the report's 38.x W-lists and calls lists, `check`, `status`) with `npm run check:workflow-ledger` — the existing `report-items.ts` has hard-coded paths and its own gate, so it's left alone.
4. Live test fixtures: a production test workspace per unit named `wt-test-<unit>` and test orgs per type; removed after each live check (evidence notes what was removed).
5. Confirm the browser pane is signed in to the production site (the user signs in once if not).

## 7. Migrations in order (renumbered from 0103)
**Numbers are taken at build time from the next free number in `drizzle/meta/_journal.json`** (other sessions share the checkout); the names below are the order. **Rules:** add-only, so each migration works with the code already live (it's applied before the push); every new table gets `ENABLE ROW LEVEL SECURITY` + policies (`check:rls-contract`); indexes on `tasks` built `CONCURRENTLY` in separate files listed in `NON_TRANSACTIONAL_MIGRATIONS` (as 0068 does); `workspaces.workflow_settings` is created in the first migration.
Part A (expected numbers from today's 0103): 0103 `task_types` (A0.1: `tasks.item_type/stage/type_fields/on_board`, `workspaces.workflows_enabled`) · 0104 `workspace_workflows` (A0.2) · 0105 `doc_sections` index (A0.4) · 0106 `doc_live_rows` (`tasks.source_doc_id/source_block/source_position`, A0.5) · 0107 `decision_numbers` unique index (A0.6) · 0108 `project_planner` (`tasks.start_date`, `tasks.part_of_id`, A1.3) · 0109 `bugs_open_index` (A2.1) · 0110 `request_types` (A2.4) · 0111 `working_hours` (A2.5) · 0112 `content_settings` (A2.7) · 0113 `meetings` (series + document reminders, A4.1) · 0114 `goals` (`key_result_check_ins`, `workspaces.workflow_settings`, A5.1) · 0115 `file_comments` (A7.2) · 0116 `scheduled_updates` (A7.4) · 0117 `undated_sprints` (nullable dates + `path_position`; auto-start skips undated, A7.6) · 0118 `lesson_progress` (A7.7).
Part B (numbered when built, contents fixed in each mini-plan): B0.1 permission function grandparent (code that needs it ships in the same unit; the function is widened add-only) + `workspaces.org_workflows_enabled` · scoped roles where named (Head of department, TA limits, Mentor only, Judge, Cover only, Moderator) in their units · B1.6 extra time + held results · B3.3 second approver · B1.3 sections + membership · B1.4 attendance · B1.5 rubrics + marks · B1.7 pins · B1.8 literature records · B2.1 programs · B2.3 mentor slots/useful/concerns · B2.4 score layouts/marks/mistakes/syllabus · B2.5 judges/awards/run of show · B3.1 day types · B3.2 taught/standards · B3.4 timetable/cover/duties · B3.5 observations/development log · B4.2 membership time zone/hours + away type · B4.3 workspace dates/supports · B4.4 start dates + New people target · B4.5 private-request read rules · B5.1 agreements/join answers · B5.2 directory/moderation · B5.3 RSVPs · B5.4 challenges/rituals · B5.5 proposals/polls · B6.1 positions/alumni · B6.2 protocols/entries/equipment/bookings · B6.3 papers/authors/submissions · B6.4 sources/notes/reading states/screening · B6.5 milestones/IDP/concerns · B7.1 renewal/recruiting · B7.2 elections/ballots · B7.3 agenda/motions/constitution · B7.4 tryouts · B8.1 shifts/hours · B8.2 org key dates · B8.3 programs/confirmations/consent.
Every migration: journal entry, schema update, `check:db:migration-journal`, `test:db` on a disposable DB, applied to production before its push.

## 8. Report coverage cross-check (done while writing this plan)
Every report section maps to units or is deliberately not built:
- **28.1–28.4, 28.11** (rule, homes, stage→status, B1–B14, New module) → A0.1–A0.11. **28.5** → A0.4–A0.6. **28.6** words → design gate. **28.7** prototype → design gate reference. **28.9** build order → Part A order. **28.10** open items: Overview cards, notifications, CLI/MCP → inside every unit (each round's part 8); **decision 6 (Free/Pro) stays open — not built**.
- **38.1–38.18** (all 17 blend rounds) → A0–A7 one-to-one; every W-journey listed is a live check.
- **Category sections 11–25**: their blended parts are covered through 38 (Project planner 11.3 → A1; Matrix 11.7 → A1.2; Roadmap/launches 11.5, 20.4, 22.4, 25.5 → A2.10–A3.8; Meetings 11.6, 13.6, 17.5, 18.3, 19.4, 20.6, 21.2, 22.3 → A4; Goals 11.4 → A5.1–A5.2; Ideas 25.2 → A5.3; Off-site 16.2 → A5.4; all 32 templates of 26.3 → A6.2–A6.33; Docs site 20.3 → A6.34; Snippets 21.4 → A6.35; Bugs 13.2 → A2.1–A2.3; Requests 21.3/24.6 → A2.4–A2.6; Content 14.2 → A2.7–A2.9; Assets 14.3/18.5/19.5/19.6/22.5/24.3 → A7.1–A7.3; Changelog 13.7 + scheduled Updates → A7.4–A7.5; Learning path 15.2 → A7.6–A7.7; wizard suggestions section 6 → A0.3).
- **Sections 29–37** → B0–B8, every workflow (W1–W8, C1–C5, S1–S5, K1–K5, M1–M5, R1–R5, L1–L4, X1–X4) and the six kits.
- **Not built (parked in 28.2 and the category/type "Parked" lists):** Money; Shop (Inventory & orders) and Suppliers; Pipeline and its 12 presets (Sales, Investors, Collaborations, Clients, Outreach, Applications, Donors, Grants, Guests, Sponsors, Commissions, Suppliers); Client portal; public Feedback page, Listener questions, Support inbox; Incidents and Status page; Event planner (except off-site) incl. registration and judging; Course planner own tab (Scheduled); Goals & OKRs tab; Podcast and Video Content setups; 1:1 meetings; public roadmap; outside bug reporting; good-first-issues page; under-18 members and K–12 students; payments, tickets, dues, budgets; calendar sync, location lookups, reference-manager sync, DOI lookups; 26.7 "later by design" items (gradebook, QR/barcodes, GitHub Issues sync, OpenAPI import, changelog RSS, public press kit). These stay in the ledger with status `n/a-live` and reason "parked".

## 9. Verification (how each unit, and the whole, is proven)
- **Per unit:** all of section 1's local checks green; design gate screenshots attached to the ledger evidence; deployed commit on Railway SUCCESS with green CI; every journey run live on production (`wt-test-*` data), Sentry clean for 30 minutes (`canary`), test data removed; ledger row → `live` with date and commit.
- **Per wave/type:** after A0, A1, A2, … and after each Part B type, run `npm run test:e2e:critical:prod` and the browser suite (`npx playwright test -c tests/browser/playwright.config.ts --project chromium`), plus one cross-unit journey (e.g. after A2: request → becomes a bug → fixed in a launch → Changelog line).
- **At the end:** `npm run test:release-gate`; `npm run check:workflow-ledger` shows every row `live` or `n/a-live` (no `live-pending` left); one full walk of an ordinary workspace and one org of each type on production; a final pass through the report against the ledger to confirm nothing is missing.

## 10. Decisions (answered 2026-11-18)
1. **Switch-on after each wave:** when every unit in a wave (A0, A1, A2, A3, A4, A5, A6, A7, then each Part B type) is live ✓, one **switch-on step** turns that wave's flag/catalog entries on for every workspace (or every org of that type), and the wave's main journeys are re-run live on a real (non-test) workspace.
2. **CLI release once per wave:** after each wave's switch-on, bump the CLI version, tag `cli-v*`, the user approves the npm publish, then `nb` from npm is checked against production (memory `project_npm_trusted_publishing`).
