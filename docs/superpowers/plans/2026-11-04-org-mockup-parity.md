# Organization mockup parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the teacher's assignment panel, the Review queue, the student's Hand in states, the board's assignment cards and the Overview match the Organization Mockups canvas.

**Architecture:** No new tables or migrations. Each screen keeps its current component and server action; the actions gain the few fields the mockups show (times, versions, sizes, who returned it), and the components are re-laid-out with the existing tokens (`nb-*` classes, mono micro labels, square chips). Existing dialogs (Roster, Return, Extend, Excuse, Give to) stay and are opened from the new layouts.

**Tech Stack:** Next.js 16 server actions, Drizzle + raw SQL on Postgres, React 19, Tailwind, node:test (unit, DB), Playwright (browser fixtures bundled with esbuild).

**Spec:** the Organization Mockups canvas, https://claude.ai/code/artifact/25d91051-b5e1-4a16-a29b-c8bbb7aa1b61, artboards `Board.dc.html`, `Review.dc.html`, `Submit.dc.html`, `Main.dc.html`, `Student.dc.html` (the comparison of each with the live site is in the 4 November conversation and summarised under "What changes" below).

## What changes

| Screen | Mockup | Live today |
|---|---|---|
| Assignment panel (teacher opens an assignment card) | Four tiles Done · Submitted · Not in · Excused; Review N, Remind N, Download all, Export; inline "Waiting for review" and "Not in yet" lists with Open/Approve and Extend/Remind/⋯ | Generic task panel, an "Assignment · 1 of 1 done" box, people only in a separate Roster window, a file warning and Code editor that don't apply |
| Review queue | Left: waiting list. Middle: the handed-in file, Download, versions. Right: their note, steps, private conversation, Return reason | One submission card, file name as text |
| Hand in (student) | State chip; coloured state box (green Submitted/Approved, red Returned with who returned it); files with size and ×; "This will be marked Late." | Plain text lines |
| Board assignment card | Chips (Draft, Assignment, Groups, N to review), progress bar, "22 of 40 done" | One text line |
| Overview | "Good morning, Ms. Rao" with the week line; class bar with three numbers; This week and Activity in the right column | No greeting; one text line; those sections in the left column |

## Global Constraints

- No new dependency, table or migration.
- Production reads Postgres arrays as text (`fetch_types: false`): any list from SQL goes through `to_jsonb(...)` or `jsonb_agg(...)`.
- Dates in the reader's own zone, named (`timeZoneName: 'short'`), as the hand-in due line already does.
- Copy uses the organization's role words (`orgRoleNames`), never "Ms. Rao's team" hard-coded.
- Menus and dialogs opened from the panel use the shared primitives (layer 300/400); no per-component z-index.
- Every list, button and tile is a real `<button>`/`<a>` with a name; icon-only buttons get `aria-label`.
- At phone width the three-column Review queue and the four tiles stack.
- Members never see any of the teacher pieces (the server already refuses; the components must not render them for non-admins).

## Review Focus

1. **A class of 0 people or all excused** — tiles read 0, the lists say "Nobody's waiting" / "Everyone's in", no divide-by-zero in the bar. Pinned in Task 1 (helper test) and Task 4 (card bar).
2. **Team (group) assignments** — the panel lists teams by team name with their people, and "Not in yet" counts teams, not people. Pinned in Task 1 DB test.
3. **A file type the preview can't show (zip)** — the Review queue middle column shows the file card with Download, not a broken viewer. Pinned in Task 2 browser test.
4. **Returned past the due date with late work closed** — the student's box says it can't be handed in, and no Submit button shows. Pinned in Task 3 DB test.
5. **More than 50 waiting** — the queue list scrolls inside its column and the page doesn't grow; "N of M loaded" only while more exist. Pinned in Task 2 browser test.

---

### Task 1: The teacher's assignment panel

**Files:**
- Modify: `src/app/actions/assignments.ts` (`RosterRow`, `readAssignmentRosterAction`)
- Modify: `src/lib/organizations/assignment-rules.ts` (new helper)
- Modify: `src/components/organizations/AssignmentsPanel.tsx` (`AssignmentManageSection`)
- Modify: `src/components/workspaces/v2/tasks/TaskDetailPanel.tsx`, `src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx` (hide the file-readiness warning and Code editor on a main assignment)
- Test: `tests/unit/org-mockup-parity.test.ts`, `tests/db/organizations-board-step13.test.ts`, `tests/browser/org-tabs.fixture.tsx` + `tests/browser/org-tabs.spec.ts`

**Interfaces:**
- Produces: `RosterRow` gains `submittedAt: string | null; version: number | null; remindedAt: string | null` (from `tasks.submission->>'at'`, `->>'version'`, and the latest `assignments.reminded` notice per copy, the same `dedupe_key` pattern `remindedRecently` reads).
- Produces: `rosterTiles(counts: AssignmentRow['counts']): { done: number; submitted: number; notIn: number; excused: number }` in `assignment-rules.ts`, where `notIn = not_started + in_progress + returned + missing`.

- [ ] **Step 1: Write the failing tests**
  - Unit `rosterTiles`: `{done:22, submitted:6, not_started:4, in_progress:3, returned:1, missing:2, excused:2, total:38}` → `{done:22, submitted:6, notIn:10, excused:2}`; all zero → all zero.
  - DB (`board-step13`): a file assignment, two copies; one handed in twice (version 2), one reminded. `readAssignmentRosterAction` rows carry `version: 2`, a `submittedAt` ISO string, and `remindedAt` on the reminded copy only; a team copy's row keeps `people`.
  - Browser (`org-tabs` fixture, stubbed roster): the panel shows tiles "22 Done · 6 Submitted · 10 Not in · 2 Excused", buttons "Review 6" and "Remind 10", a "Waiting for review" row "Asha Rao · Today, 8:40 AM · Version 2" with Open and Approve, and a "Not in yet" row "Meena P · In progress · Reminded 3h ago" with Extend and More.
- [ ] **Step 2: Run them and see them fail** — `npx tsx --test tests/unit/org-mockup-parity.test.ts`, the DB file with `DATABASE_URL_FRESH`, `npx playwright test -c tests/browser/playwright.config.ts --project=chromium org-tabs`.
- [ ] **Step 3: Implement**
  - Roster fields in the existing copies query; `remindedAt` from one grouped query `max(created_at)` per copy id.
  - `AssignmentManageSection` layout, top to bottom: tiles (each a `<button>` that filters the lists below); actions `Review N` (link to `?tab=tasks&taskScope=review&assignment=<masterId>`), `Remind N` (`remindCopiesAction`), `Download all` (existing link, files only), `Export` (existing CSV); "Waiting for review" rows (avatar, name, time · Version N · Late, `Open` = the copy's drawer link, `Approve` = `reviewAssignmentCopyAction(copyId,'approve')`); "Not in yet" rows (state · Reminded … ago, `Extend` opens `ExtendDialog`, `Remind` for not started, `⋯` menu with Excuse, Remove, Return); a "Full roster" button opens the existing `RosterDialog` for bulk select, steps, Give to and team moves; the old Edit for everyone, Use again, Close and Delete move into a `⋯ Manage` dropdown at the section's top right. Drafts and scheduled keep today's Publish/Schedule/Back to draft row instead of tiles.
  - On a main assignment (`isAssignmentMaster(task)`): no file-readiness warning, no Code editor button.
  - The Review queue reads `assignment` from the URL to start filtered (Task 2 owns the queue; this task only writes the link).
- [ ] **Step 4: Run the three tests; they pass.**
- [ ] **Step 5: Commit** `feat(org): the assignment panel shows the class at a glance`.

### Task 2: The Review queue

**Files:**
- Modify: `src/app/actions/assignments.ts` (`ReviewQueueRow`, `readReviewQueueAction`)
- Modify: `src/components/organizations/AssignmentsPanel.tsx` (`ReviewQueue`)
- Test: `tests/db/organizations-review-step13.test.ts`, `tests/browser/review-queue.fixture.tsx` + `tests/browser/review-queue.spec.ts` (add to `testMatch`)

**Interfaces:**
- Produces: `ReviewQueueRow.files: Array<{ nodeId: string; name: string; size: number | null }>` (built with `jsonb_agg(jsonb_build_object(...))`); `ReviewQueueRow.versions: Array<{ version: number; at: string; files: string[] }>` (earlier versions, newest first, from `assignment_submissions`).
- Consumes: `getNodesByIds(projectId, ids)`, `getFilePreviewUrl(projectId, nodeId)`, `UniversalPreviewEngine`, `readTaskDiscussionAction(projectId, copyId)` (latest 3 comments, private conversation).

- [ ] **Step 1: Write the failing tests**
  - DB: a copy handed in twice; the queue row's `files[0]` has `nodeId`, `name`, `size`; `versions` lists version 1 with its file names.
  - Browser (stubbed actions): three regions named "Waiting", "Submission", "Details"; clicking the second waiting row makes it current; a `.zip` shows a file card with "Download" (no viewer); a `.pdf` mounts the preview; "Their note", "Steps 4 of 5 ticked", the last comments under "Private conversation"; Return shows "What should Asha change?"; at 390 px wide the three regions stack; 60 stub rows scroll inside "Waiting" (its `scrollHeight > clientHeight`, page height unchanged).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** — a three-column grid (`minmax(0,240px) minmax(0,1fr) minmax(0,300px)`, one column under `md`); the left list reuses `shown` and sets `index`; the middle loads the current row's first file node and preview URL, shows the preview engine for previewable kinds and a file card otherwise, plus `Download` (`getFilePreviewUrl(..., true)`) and a "Versions" select listing earlier versions' files; the right column holds the note, steps, the three latest private comments with an "Open" link to the copy, then the Return reason form and Approve / Return / Add note, as today. Keyboard keys and the toasts stay. The "N of M loaded" line shows only while `rows.length < total`. The `assignment` filter starts from the URL's `assignment` parameter when it names a listed assignment (Task 1's "Review N" link); the browser test opens the fixture with `?assignment=` and sees only that assignment's rows.
- [ ] **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit** `feat(org): the review queue shows the work beside the list`.

### Task 3: The student's Hand in states

**Files:**
- Modify: `src/app/actions/assignments.ts` (`HandIn`, `readHandInAction`)
- Modify: `src/components/organizations/HandInSection.tsx`
- Test: `tests/db/organizations-board-step13.test.ts`, `tests/unit/org-mockup-parity.test.ts`

**Interfaces:**
- Produces: `HandIn.files` and `HandIn.latest.files` items gain `size: number | null`; `HandIn.returned` gains `by: string | null` (the reviewer's name from the `changes_requested` event's actor); `HandIn.wouldBeLate: boolean` (handing in now would be late: past due plus the late-after minutes, and late work allowed).
- Produces: `handInChip(state: CopyState, approved: boolean): { label: string; tone: 'info' | 'warn' | 'ok' | 'danger' | 'muted' }` in `assignment-rules.ts`: not_started → "Not started"/muted, in_progress → "In progress"/info, submitted → "Submitted"/warn, done+approved → "Approved"/ok, done → "Done"/ok, returned → "Returned"/danger, missing → "Missing"/danger, excused → "Excused"/muted.

- [ ] **Step 1: Write the failing tests**
  - Unit: `handInChip` for each state above.
  - DB: after a Return by the owner, `returned.by` is the owner's name; a file row has `size`; past due with late "always", `wouldBeLate` is true; past due with late "none", `canSubmit` is false and `wouldBeLate` false.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** — the section header gets the chip; Submitted/Approved show a green box ("Submitted Tue 10 Nov, 4:12 PM GMT+5:30" / "Approved · It's locked now") with "Version N · Waiting for review" under it; Returned shows a red box "<by> returned this" with the reason and Fix by; files render as rows (name, size, × while open, from the live-loop fix); "This will be marked Late." under Submit when `wouldBeLate`. Colours use the existing status tokens (`--status-*`), not new ones.
- [ ] **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit** `feat(org): hand-in states read at a glance`.

### Task 4: Assignment cards on the board

**Files:**
- Modify: `src/components/workspaces/v2/tasks/TaskCard.tsx` (`assignmentProgressLine` and the assignment row)
- Test: `tests/unit/org-mockup-parity.test.ts`

**Interfaces:**
- Produces: `assignmentCardBits(p: { draft; closed; done; total; toReview; excused; teams?: boolean }): { chips: string[]; percent: number; line: string }` exported from `TaskCard.tsx` — chips in order `Draft` (draft), `Assignment`, `Groups` (teams), `N to review` (toReview > 0); `percent = total ? round(done/total*100) : 0`; `line` = today's `assignmentProgressLine` text.

- [ ] **Step 1: Failing test** — `{draft:false, closed:false, done:22, total:40, toReview:6, excused:0}` → chips `["Assignment","6 to review"]`, percent 55, line "22 of 40 done · 6 to review"; total 0 → percent 0, line "Nobody has joined yet"; draft → chips start with "Draft".
- [ ] **Step 2: Run; it fails.**
- [ ] **Step 3: Implement** — chips row above the title using the existing chip style, a 5 px bar (`role="img"` with `aria-label` "22 of 40 done"), the line under it; `teams` comes from the assignment settings target mode the board row already carries (add it to `assignmentProgress` in `readMasterProgress` if missing).
- [ ] **Step 4: Run; it passes.**
- [ ] **Step 5: Commit** `feat(org): assignment cards show progress`.

### Task 5: Overview greeting, class bar and columns

**Files:**
- Modify: `src/app/actions/org-dashboard.ts` (`OrgDashboardData`, `readOrgDashboardAction`)
- Modify: `src/components/organizations/OrgOverviewParts.tsx` (`OrgDashboard`)
- Test: `tests/db/organizations-overview.test.ts`, `tests/unit/org-mockup-parity.test.ts`

**Interfaces:**
- Produces: `OrgDashboardData.greeting: string` from `greetingFor(hour: number, name: string | null)` in `src/lib/organizations/dashboard-rules.ts`: hour 5–11 "Good morning", 12–16 "Good afternoon", otherwise "Good evening"; `, <first word of full name, else username>` when known. The hour is in the organization's zone.

- [ ] **Step 1: Failing tests**
  - Unit `greetingFor`: (8, "Ramanayudu CH") → "Good morning, Ramanayudu"; (14, null) → "Good afternoon"; (22, "Asha Rao") → "Good evening, Asha".
  - DB: `readOrgDashboardAction` for the owner returns a `greeting` starting "Good"; `weekLine` unchanged.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** — a heading row "<greeting>" with `weekLine` on the right (only when term dates exist, as today); "How the class is doing" becomes the stacked bar (`role="img"`, `aria-label` "34 on track, 4 behind, 2 inactive"; zero total draws an empty track) with three linked numbers; This week moves to the top of the right column and Activity to its bottom, for every role.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: Commit** `feat(org): Overview greets you and shows the class at a glance`.

### Task 6: Gate and live check

- [ ] Typecheck (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`), lint the changed files, `npm run -s test:unit`, the full DB suite against the disposable database, the full chromium browser suite, and the four checks (terminology, authz-contract, rls-contract, migration journal). All green.
- [ ] Commit locally; push only on the user's word. After the deploy: as the teacher, open Lab 1 (tiles, lists, Approve from the panel) and the Review queue (preview, versions, conversation); as the student, Hand in, Returned and Approved boxes; the board card; Overview for both roles, and phone width.

## Calls I made (check these)

- "Compare versions" in the mockup becomes a Versions picker of earlier files, not a side-by-side diff; a diff of two zips has nothing to show.
- The panel's footer tabs (Class questions · Instructions · Files) aren't added: the panel already has Details, Comments and Files tabs, and Class questions sits in Comments.
- The greeting uses the first word of the person's full name ("Good morning, Ramanayudu"), since names like "Ms. Rao" aren't stored.
- The full Roster window stays for bulk actions, steps, Give to and team moves; the panel shows the two lists the mockup shows.
