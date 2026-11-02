# Organization End-to-End Implementation Plan (master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything in the organization report, sections 1–45 and decisions 1–177, in the report's build order, with nothing left out.

**Architecture:** An organization stays a workspace with more powers. Every change goes into the shared workspace screens and the server rules (`orgGrant`, `getWorkspaceAccess`, `orgTaskReadFilter`, `orgFileAccessSql`, `assertWorkspaceWriteAccessTx`), never into parallel screens. The work ships as 22 small deploys: four fix deploys (1a–1d), the foundations, one deploy per tab, a final pass, a pilot, and what comes after it.

**Tech Stack:** Next.js (non-standard; read `node_modules/next/dist/docs/` before writing code), Drizzle, Postgres with RLS and triggers, Supabase, Inngest, Resend, Sentry, Railway, `tsx --test` tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-organization-end-to-end-design.md`. This plan is the index into it. Each step implements the report sections it names **in full**, including every table row in them.

## Context

The owner designed organizations end to end in one report before building anything. It is about 6,500 lines long: 45 sections, 177 locked decisions, 53 problems and 24 smaller bugs in the core workflow, 42 + 68 gaps and 6 conflicts. The owner asked for one plan that carries every item, so nothing is lost because the report is big. This plan:

1. Puts the report's build order (section 12, the 41.3 deploy split, and every "How this gets built" table) into executable steps.
2. Assigns every decision, problem, smaller bug, gap, conflict, database change and subsection to a step (Appendices A–F).
3. Checks that mechanically: a script compares the report's IDs with this plan's appendices and step bodies (Appendix G). It was run five times, and the last run found nothing missing.

## Global Constraints

- Build only after the owner says "implement". Work directly on local `main`. Commit locally. No push, `db:setup`, live migration or Railway action until the owner approves each one.
- Dependencies: never `pnpm add` or `pnpm install`. Use `npm install --package-lock-only`, then `npm ci`.
- No temporary routes in the repo. Test on a scratch copy on port 3100.
- Database changes only add, start after the latest live migration (`0041_workspace_last_update.sql`; check that the next number is still free), and go live before the code that uses them (116).
- No new scheduled job (119). The Inngest budget test caps scheduled runs at 480 a day, with 416 used.
- No feature flags, except one temporary switch on the Tasks step while real classes are running (113, 166).
- Every organization fix is scoped to organizations, their workspaces or assignment copies, unless 41.6 lists it as shared on purpose (161). Each shared change ships with a normal workspace test (162). Normal workspaces look the same unless 41.6 says otherwise (115).
- The five rules for every screen (section 2), the people table (section 3) and the role words (39.4) apply to every screen.
- Wording follows the shipped terminology in `terms.ts` (108), the glossary (39.4) and the plain words rule: "Project" is never shown.
- The mockups (section 40, https://claude.ai/artifact/5g54UupcpNCxS5bT32WcYQ) set the look. Where they differ from the report on behavior, the report wins (111).
- Later corrections win over earlier text: 30.1, 34.2, 39.1, the 41 "What this corrected" table, 42.18, and any decision marked "Changes" or "Replaces".
- **Report conflict, settled here:** the 44.5 test table lists problems 3, 8 and 9 under 1b, and 44 under both 1a and 1b. 42.7, 42.15 and 41.2 place problem 3 in Sprints (step 12, it needs the sprint job change), problems 8 and 9 in Tasks (step 13, they need the submission record table, DB9), and problem 44 in 1a. This plan follows 42.7, 42.15 and 41.2. Those tests are written in the step that fixes the problem.
- Launch is 18 and over (163). No grades, attendance, peer review, LMS import, plagiarism checks, AI writing, billing or parent accounts (45.11).
- Tests run on the disposable database: `npm run db:disposable`, then `env -u DATABASE_URL DATABASE_URL_FRESH=postgresql://postgres@localhost:54332/nb_test npm run test:db`.

## How each step is run (from CLAUDE.md)

For every step below:

- [ ] **Cut:** `ponytail-audit`. List what the step deletes, and ledger any shortcut with `ponytail-debt`.
- [ ] **Plan:** `superpowers:writing-plans`. Write the step's own short TDD plan in `docs/superpowers/plans/`. Read every report section the step names, including its "What the code showed" table, first. Each tab step also reads its own shared screens line by line (44.8, risk 3).
- [ ] **Scope guard:** `freeze` on the step's folders.
- [ ] **Build:** `ponytail` + `superpowers:test-driven-development`. Write a failing test first for every SQL and query change, and one test per problem (44.5).
- [ ] **Measure:** `benchmark`, with before and after numbers. Overview, Tasks and Files may be no more than 20% slower, and the board with 2,000 members stays under 2 s (41.7). Re-run `tests/db/organizations-scale.test.ts`.
- [ ] **Review:** `ponytail-review`, then `review`.
- [ ] **Gate:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `test:db` on the disposable database, `check:terminology`, `check:authz-contract`, `check:rls-contract`, and `check:db:migration-journal` when there's a migration. Screens: the 44.6 checks (375 px phone, dark mode, keyboard, `axe`, the same tab in a normal workspace before and after, and the matching mockup board).
- [ ] **Ship:** only on the owner's approval. Apply the migration live, push, re-sync Inngest if jobs changed, run `canary` on the live site, and record measurements (41.1). Roll back by the 41.5 rules.
- [ ] **Talk:** `caveman` (lite) for status and `caveman-commit` for commits.

## Review Focus

1. **A member reaching someone else's work through a side door:** an ID guessed from live events, an extension route, a search, a notification link, a timeline. Every read added in a step goes through the shared visibility rule, with a member test that it's refused.
2. **The same rule enforced in one place and forgotten in another:** hand-in lock, late rule and review must hold in the board, the task panel, the queue, the roster, the editor extension and the API. Each such rule lives in one server function, with a test per entry point.
3. **Normal workspaces quietly changing:** each step runs the workspace tests in 41.6 and screenshots a normal workspace before and after.
4. **Existing organizations after a deploy:** empty Last active here, old ended entries, old assignments without a late date, old drafts holding people who have left. 41.4 decides each; each case gets a test with old-shaped data.
5. **Two admins at once, and retries:** a double review, a publish retried after a partial failure (smaller bugs 6 and 15). Each mutating action gets an idempotency or "already done" test.

---

## Step 0 — Baseline (before any code)

**Report:** 43, 43.1, 44.4, 10.5. **Decisions:** 166.

- [ ] Record `git status` and `git log origin/main..main`. Local main carries other unpushed work; this step only records it and changes nothing.
- [ ] Read 43 and 43.1 (open risks and what's still open) before starting.
- [ ] Ask the owner to run the 44.4 read-only count in the Supabase SQL editor. Until they do, assume real classes are running (166).
- [ ] Run the full baseline: `typecheck`, `lint`, `test:unit`, `test:db` on the disposable database, and `test:e2e:critical:dev`. Record what already fails, especially the browser files (10.5). The test repair (fixtures, locators, WebKit focus) is partly done in fe60dc366..fda8d6369. Finishing it runs alongside 1a–1d.
- [ ] Record benchmark baselines for Overview, Tasks, Files and the 2,000-member scale test (44.3 numbers).
- [ ] Confirm the next migration number, and that `check:db:migration-journal` passes.

---

## Step 1a — Privacy (deploy)

**Report:** 41.3 1a, 42.1, 42.4, 42.7, 42.10, 42.12, 42.13, 42.14, 42.15, 29.1, 29.4, 29.6, 31.1, 31.2, 31.8, 23.6, 24.1, 24.4, 27.1, 27.10, 36.7.
**Decisions:** 5, 15, 16, 27, 37, 41, 53, 62, 69, 95, 103, 112, 117, 121, 137, 144, 145, 149, 152, 153, 166.
**Problems:** P1, P16, P24, P28, P30, P37, P40, P41, P44, P49.

**Items (verbatim from 41.3 and the 42.x build tables):**
- [ ] Hiding drafts from members (42.7). This is problem 1, including the database rule `nb_task_visible`, `orgTaskReadFilter`, `readOrgDashboardAction`, the timeline, activity, Overview and files (decision 121, "who can see an assignment").
- [ ] Hiding Admins-only material names (42.10, problem 16; decision 137, first half).
- [ ] Comment privacy: `assertTaskAccess` follows the task's visibility, and mentions are limited to people who can see the conversation (23.5, 23.6, decision 37, 42.14 "Checked and fine").
- [ ] Suspension reason shown only to owners and admins (27.7, decision 53).
- [ ] Last active here: per-membership value updated at most hourly; admins never see account-wide times (29.4, 29.6, decision 62; DB1). Empty shows "No data yet" and never counts as inactive (41.4, 117).
- [ ] The indexing rule: Discover, the sitemap and page indexing use one check; new organizations aren't indexed until they qualify; already public ones stay indexed (31.2, 31.8, decision 69, 41.4).
- [ ] Outsiders applying (25.4, 36.3).
- [ ] The GitHub visibility rule: Organization-only or Private workspaces inside an organization use only private repositories, checked on connect and every push (24.3, 24.4, decision 41).
- [ ] Nobody reviews their own or their group's work, for assignment copies only (36.2, 36.7, decision 95, 42.18 #2).
- [ ] Problem 24: the sprint timeline uses the shared visibility rule (decision 144, second half).
- [ ] Problem 28: steps change only for the copy's assignee or team, and main-assignment steps only for admins (`lockSubtaskWriteScope`).
- [ ] Problem 30: copy changes stop going to the organization's board topic; live events go only to the copy's people and admins (decision 145; DB10, `0034_live_row_events.sql`).
- [ ] Problem 37: only admins and a team's lead reassign within that team; individual copies have no reassign control (decision 149, `assignTaskAction`).
- [ ] Problems 40, 41, 44 and 49: posts default to Members, and Public says "Also on Discover" (decisions 5, 27, 152; `WorkspaceUpdateComposer.tsx:174`). Followers get only Public posts meant for everyone (153). A failed post keeps its audience (`UpdatesTab.tsx:202`). Likes follow the audience.
- [ ] Owner notice for this deploy, sent to every organization's owner, saying what changed (166).

**DB:** DB1, DB8, DB10.
**Tests:** 44.5 rows for 1a (`organizations-assignments`, `live-row-events`, `organizations-files`, `workspace-tasks-actions`, `organizations-updates`). Guards: a new test that a workspace admin can still review their own normal task (95 is for copies only, 41.6), `task-discussion.test.ts`, `workspace-tasks-actions.test.ts`, `live-row-events.test.ts`, `workspace-updates-actions.test.ts` (41.6).

## Step 1b — Correct work (deploy)

**Report:** 41.3 1b, 42.1, 42.2–42.7 (42.3, 42.4, 42.5), 42.10–42.17, 19.3, 21.5, 23.6, 24.1, 24.2, 24.4, 25.9, 26.1, 26.11, 27.1, 27.6, 27.10, 34.1, 34.8, 35.6, 36.3, 36.6, 38.1, 38.10, 45.1, 45.4.
**Decisions:** 14, 26, 31, 38, 42, 43, 45, 50, 52, 85, 86, 87, 90, 96, 104, 106, 112, 120, 121, 124, 127, 129, 130, 133, 134, 135, 136, 140, 141, 142, 143, 144, 146, 147, 150, 151, 154, 155, 156, 157, 158, 160, 166, 173.
**Problems:** P2, P4, P5, P6, P7, P11, P12, P13, P14, P15, P18, P20, P21, P22, P23, P25, P26, P29, P31, P32, P34, P35, P36, P38, P39, P42, P43, P45, P46, P47, P48, P50, P51, P52; smaller bugs S1, S3, S4, S5, S6, S9, S10, S15, S16, S17, S22.

**41.3 list:**
- [ ] The rejoin fix: the existing-copy check ignores copies deleted on leaving (`createCopiesForNewMember`, `assignments.ts:192`; decision 50).
- [ ] Delete block when handed-in work exists: a workspace holding handed-in work can only be archived (35.3, decision 90).
- [ ] Server block on dragging assignment cards; they sit in a fixed column (23.4, decisions 14 and 38).
- [ ] Approved work locked (34.4, decision 85, second half).
- [ ] Group work locks: one server check that every task write passes through, including the editor extension, through the permissions table (19.3, 21.5, decisions 26 and 31).
- [ ] Returned stays visible past due (34.4, decision 86).
- [ ] Server refuses member-created tasks on the organization's board (34.5, decision 87).
- [ ] Placing accepted applicants in their team, and the outside-people check (25.4, 25.9, decision 96).
- [ ] Locked record fields: role and dates on contribution entries are locked on the server (38.3, 38.4, decision 104).
- [ ] Start from my work and Work record count only approved or finished work (38.7, 38.8, decision 106).
- [ ] Duplicate dates move from the term start, or else the first sprint (27.4, decision 52).
- [ ] Editor locks (members are read only on organization files, decision 42) and the task check on attachments.
- [ ] Removing copies from publish-and-complete, and dropping closing keywords (24.3, decision 43).
- [ ] The owner limit on transfer, the 50-organization check and the wizard's limit check (26.11, 27.10).
- [ ] The editor's task push names its task in the shared write check, and the hand-in lock lives in `assertWorkspaceWriteAccessTx` (45.4, decision 173).

**Core workflow problems:**
- [ ] 2: Late is measured from the submission time ("when something was handed in", 121).
- [ ] 4: assignments stay in their sprint; only tasks count as unfinished (124, `completeSprintAction`).
- [ ] 5: group work follows whoever leads the workspace (129, "when a lead changes", 121).
- [ ] 6: detaching keeps handed-in work on the roster as "Team Falcon · Detached" (130, `releaseGroupCopies`).
- [ ] 7: moved-in workspaces get open group work (`moveIntoOrg`).
- [ ] 11: one link helper, `?tab=tasks&drawerType=task&drawerId=<copy>`; old `tab=assignments` links redirect (133).
- [ ] 12: transfer asks for identity in place, in organizations and workspaces (134).
- [ ] 13: "Allowed until a date" requires a date, 7 days after due by default; old ones without a date show "Late work closed" (135).
- [ ] 14: everyone sees their own copy's date, with "Extended".
- [ ] 15: Publish handles people who have left ("Publish to the other 38?"); Duplicate resets who it's assigned to (136).
- [ ] 18: the main assignment and its copies change sprint together.
- [ ] 20: moving a copy to Completed opens Submit, and only Submit hands in (140).
- [ ] 21: panel Approve works; one review path (141).
- [ ] 22: panel Delete on a main assignment follows the assignment rule (142, C1).
- [ ] 23: only admins change the main assignment (19.3, 23.3).
- [ ] 25: sprint numbers count copies (144, first half).
- [ ] 26: any copy with a submission stays on leaving (143).
- [ ] 29: Submit saves the check value.
- [ ] 31: admins can put tasks in sprints, in organizations and normal workspaces (146; shared on purpose, 41.6).
- [ ] 32: deleting a student's copy follows the handed-in rule and tells them.
- [ ] 34: a main assignment's panel has no Status, Section or Assignee controls (147).
- [ ] 35 and 36: group work opens from the queue, and organization admins get Comments, Files, Approve and Return on group copies (150).
- [ ] 38: handed-in files lock with the version (151, 127).
- [ ] 39 and 51: the assignee or team can add, rename, remove and replace files on their own copy before Submit, from Files, the task panel or the editor (158).
- [ ] 42, 43, 45, 46, 47 and 48: shared-up posts take organization likes and comments; Viewers can't comment or like; the server sets post type by role (155); pin slots free up; one audience rule for feed, Overview, sidebar dot, likes and comments (154); read-only refuses every post change (156; DB11).
- [ ] 50: hand-ins never blocked by organization storage; they have their own allowance (157).
- [ ] 52: Settings' second Members list removed on organizations (160; 22.1 #7).

**Smaller bugs:** 1, 3, 4, 5, 6, 9, 10, 15, 16, 17, 22. Smaller bug 11 is withdrawn (checked by the database).
- [ ] Owner notice for this deploy (166).

**DB:** DB11.
**Tests:** 44.5 rows for 1b. Guards from 41.6: normal review flow unchanged, `deleteTaskAction` normal test, own-copy file actions (`workspace-files-actions.test.ts`, `file-capabilities.test.ts`), admin-adds-task-to-sprint test, read-only guard in `workspace-updates-actions.test.ts`, step-up transfer test. Extension tests from 45.4: own copy allowed, another's refused, handed-in group work refused (`task-push-receipts.test.ts`).

## Step 1c — Notices (deploy)

**Report:** 41.3 1c, 28.1, 30.4, 30.8, 28.9, 35.6, 39.5, 42.7, 42.12, 45.1, 45.5.
**Decisions:** 57, 60, 66, 74, 93, 112, 117, 142, 166, 174.
**Problems:** P27; smaller bug S2.
- [ ] The two new event types, for reminders and for team or group moves (30.4, decision 66). Confirm whether `assignments.reminded` and `org.team_changed` need a database change (41.2).
- [ ] Wrong-day fix: notices always use the person's time zone (32.5, 32.9, decision 74, first half).
- [ ] Archive notice: archiving a workspace tells its team and lead (35.3, decision 93).
- [ ] Role-change wording (39.5).
- [ ] Remind's wrong count: it reports who was really sent and who was skipped (28.8, decision 60).
- [ ] Move-in Approve and Decline in Workspaces → Requests and Needs your attention (28.6, decision 57).
- [ ] The corrected inactive rule: 14 days from joining (28.7, decision 60).
- [ ] Smaller bug 2: Reminders Off also stops overdue emails.
- [ ] Problem 27: deleting an assignment tells the people who had it, "Lab 3 was removed" (142, second half).
- [ ] Deleted-account notice to admins, and the roster shows "Deleted user" under Former (45.5, decision 174, `hard-delete.ts:96`).
- [ ] No catch-up notices for old assignments (41.4, 117).
- [ ] Owner notice for this deploy (166).

**Tests:** `organizations-notifications.test.ts`, `organizations-notices.test.ts`, notice date tests (41.6).

## Step 1d — Wording (deploy)

**Report:** 41.3 1d, 9, 17.9, 25.2, 27.1, 27.10, 31.5, 31.8, 32.3, 35.6, 39.4, 39.5, 42.10, 42.15, 44.1, 29.5.
**Decisions:** 44, 55, 63, 75, 108, 110, 112, 163, 167.
**Problems:** smaller bugs S12, S20.
- [ ] The global focus ring (32.3, decision 75, first half; shared on purpose, 41.6).
- [ ] The sidebar plus button link, the "No workspaces yet" flash replaced by a loading row, long-title rows, and the remaining sidebar rows (9, 31.5, gap 62).
- [ ] Wizard and ready screen wording (27.2, 27.3, 35.2 wizard changes, gaps 36 and 37). Names are 3–100 characters and welcome notes 500 (27.8, decision 55).
- [ ] The terminology check: add the organization words to `check:terminology` (39.5, decisions 44, 108, 110).
- [ ] The parity report's remaining wording (`docs/organization-workspace-parity-report.md`).
- [ ] Smaller bug 12: "Returned", never "Returned for changes".
- [ ] Smaller bug 20: organization feeds lose the follower and progress wording.
- [ ] 18-and-over (decision 163): the Education card says "A college or university class"; the join page and invite email say "You must be 18 or older to join"; Report gets "This person may be under 18", routed to the team in 29.2.
- [ ] Privacy Policy section drafted from 29.4 (what admins can see, plus the retention table), kept unpublished until a lawyer reviews it (decision 167, decision 63's third place).

## Step T — Type profile (before the tabs)

**Report:** 21.1–21.5, 10.3, 39.2, conflicts C3, C5, C6.
**Decisions:** 32, 33, 34, 109.
- [ ] One type profile (Education, Company, Community, Club, Research) sets words and starting values, never power; settings stop following the type once saved (21.2, decision 32, gap 1, C3: Submissions for Education, Final files for the rest).
- [ ] It replaces the checks at `CreateWorkspaceWizard.tsx:118`, `FilesTabRoot.tsx:797`, `CreateSprintModal.tsx:338`, `chat-rules.ts:17`, `creation.ts:91`, `file-rules.ts:34`, `settings.ts:120` and `lifecycle.ts:901` (21.5).
- [ ] Fill in saved type settings for existing organizations, adding only what's missing (DB3, 41.4).
- [ ] The permissions table (21.3, 39.2) becomes the real check, with a test that keeps actions in line with it (decisions 33 and 109, gap 10, C6: members can't invite). `childGrant` gets used or deleted.
- [ ] The limits in 21.4 each get a check before starting and a plain message (decision 34, gap 11). Up to 500 invites per paste (C5). Invites per day are 1,000, shown as "412 left today".
- [ ] From here on, each tab step moves its own permission checks to the table and adds its limits and notices (21.5, 39.5).

**DB:** DB3.

## Step 2 — Membership and profile

**Report:** 4.1–4.7 (4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7), 10.1, 16.9, 16.10, 26.1, 26.9, 26.10, 26.11, 31.3, 36.4, 36.7, 38.1–38.12 (38.2, 38.3, 38.4, 38.5, 38.6, 38.9).
**Decisions:** 1, 2, 3, 4, 13, 19, 48, 71, 97, 105, 107.
- [ ] Membership states and credit: removal records why, removes the chip and withdraws verification; others see nothing after removal; the person keeps a private copy (4.1–4.3, 4.7, decisions 1, 2 and 3, gaps 1 and 11).
- [ ] Role labels: the owner never shows as "Contributor" (4.4, gap 2).
- [ ] Profile: the Organizations right-column section, between Collaboration preferences and Links, with one "Show on my profile" switch per organization and per-entry publish; drafts are separate from public on your own profile (4.5, 4.6, 16.9, decisions 4 and 13, gap 3).
- [ ] The profile's Workspaces section holds workspaces only (31.3, decision 71, gap 60).
- [ ] Data: `end_reason`, who ended it, and the written reason (10.1, 36.7, DB2). Clear on rejoin. The public query filter in `collaboration.ts`. Verification cleared with `verification_revoked_reason`. Real activity times. Old ended entries aren't guessed and count as "left" (41.4).
- [ ] Private page states: invited, waiting, declined, left, removed, blocked, ended (26.9, decision 48, gap 34). The leave dialog (26.10, gap 35).
- [ ] Contribution editor: Manage organizations, the editor, position history, publishing, write-up nudges with nudge dismissed (DB5), who sees an entry (38.2–38.9, 16.10, decisions 105 and 107). A private organization's entry shows only to you and its members. The heading becomes "Workspace" (shared on purpose, 41.6).

**DB:** DB2, DB5.
**Tests:** `organizations-profile.test.ts`, `contribution-stories.test.ts`, `check:profile-contributions`, one database test per row of the 4.3 membership table (10.5).

## Step 3 — Shared blocks

**Report:** 5.1–5.4 (5.1, 5.2, 5.3, 5.4), 5.7, 7.1, 10.2, 16.13, 17.1, 25.2, 34.2, 37.6, 39.4, 39.5, 42.11.
**Decisions:** 20, 22, 44, 84, 108, 110.
**Problems:** smaller bug S13.
- [ ] Section, Row, Activity item (with the 5.3 icons), Empty state (six states, rule 2) and Status chips, with one set of status words (5.1–5.4, 5.7, decision 84).
- [ ] The role-word helper for plurals and counts (39.5, decision 110), replacing hand-written plurals (10.2).
- [ ] Tab bar (37.6), including smaller bug 13: `?tab=members` doesn't flash Overview.
- [ ] Header for all tabs (7.1): the top bar button is outlined everywhere (gap 17). Child workspace header (17.1): no Admin chip for the workspace's own owner; the organization name once; follow and view counts hidden on organization-only workspaces; a real browser tab title (gaps 25–28, decision 22).
- [ ] One small organization context loaded once per page, and named slots on the shared screens instead of scattered `if`s (10.2, 16.13).
- [ ] The visitor tab table from 34.2.

## Step 4 — Overview

**Report:** 7.2, 6, 16.6, 17.2, 26.1, 26.7, 27.1, 27.5, 29.6, 31.8, 32.4, 33.1, 33.2–33.6 (33.3, 33.4, 33.5, 33.6), 33.8, 40, 41.4.
**Decisions:** 7, 19, 20, 21, 49, 54, 70, 76, 79, 80, 81, 82.
- [ ] Temporary Get started: clickable, gone once real work exists (7.2, decision 7, gaps 7 and 15).
- [ ] Today by person, This week, How the class is doing (on track, behind, inactive), the sprint-ending row, and the Close-out list (33.3–33.6, decisions 80 and 81, the "Essential" and "High" rows of 33.8).
- [ ] Needs your attention with type, urgency and one-click actions (gap 16). Coming up counts calendar days in the organization's zone (7.2 fix).
- [ ] Redesigned sections by stage (16.6, 6, decision 79). Child workspace Overview: What's happening stays above About (17.2, decision 21). "Open roles" and "Teams and open seats" become one name (gap 32).
- [ ] The welcome panel, shown once, with welcome panel dismissed (26.7, decision 49, gap 32 of §20, DB4).
- [ ] Term-end prompt for Education from 14 days before (27.5, decision 54, gap 13), and archived states across tabs (27.10).
- [ ] The restricted notice (29.2, 29.6). The ✓ on the header (31.8, decision 70).
- [ ] Overview's live updates (32.4, decision 76).

**DB:** DB4.

## Step 5 — About

**Report:** 7.3, 16.7, 33.2.
**Decisions:** 19, 79.
- [ ] Stages come from the data, show when empty so people learn they exist, and a single sprint never shows a lone dot (decision 79, gaps 5 and 6).
- [ ] The handle gets a Copy button (gap 21). About by person (16.7).

## Step 6 — Invite panel and join page

**Report:** 5.5, 7.11, 26.1, 26.2, 26.3, 26.6, 29.4, 29.6, 21.4.
**Decisions:** 34, 51, 63.
- [ ] One invite panel with one data read, replacing three designs: link, a clear copied state, and an email preview in the dialog (5.5, 7.11, 10.2, gap 4). No QR code (section 14).
- [ ] Joining by code with no account (26.2, gap 27 of §20), invite emails (26.3, gap 28), organization full (26.6, gap 31), and every code state on the join page (gap 14).
- [ ] The join page line saying what admins can see (29.4, 29.6, decision 63). Viewers join only by email invite (decision 51).

## Step 7 — Updates

**Report:** 7.5, 16.3, 17.7, 18.1, 18.4, 28.1, 28.3, 30.5, 37.1, 37.3, 42.15, 40.
**Decisions:** 5, 8, 19, 20, 23, 27, 58, 67, 100, 152.
**Problems:** smaller bug S21.
- [ ] Options inside the one composer (16.3, decision 8, gap 19). Publishing to zero people explains why (gap 8). The empty Recent activity line fits organizations (gap 20).
- [ ] Child workspace composer: the audience matches the workspace, never Public on an organization-only workspace (17.7, 18.4, gaps 33 and 39).
- [ ] Seen counts, replies, reactions and pins (28.3, decision 58, gap 50). Email counter and at-limit message (28.3, decision 67, gap 51). Smaller bug 21: the limit counts the organization's calendar day and ignores deleted posts.
- [ ] Card actions, audience, and Hide from the organization's feed (37.3, decision 100, DB6).
- [ ] Report on each post (29.2 entry points).

**DB:** DB6. **Tests:** `organizations-updates.test.ts`, `organizations-updates-pass.test.ts`, `workspace-updates-actions.test.ts`.

## Step 8 — Files

**Report:** 7.8, 16.4, 17.5, 18.1, 18.6, 24.2, 28.1, 28.5, 37.1, 37.5, 38.1, 42.16.
**Decisions:** 8, 11, 12, 19, 20, 23, 42, 61.
- [ ] One file browser with the left panel: All files, Task files, Sprint materials, Submissions, Recent, Starred, Trash (16.4, decision 8).
- [ ] Folder access in each folder's menu (decision 11). Storage leaves Files (decision 12, gap 18).
- [ ] Templates, Download all (one folder per person or group, under 2 GB), and size messages (28.5, gap 54). Admins-only folders can't be templates (decision 61).
- [ ] Pages, Trash, the in-use warning and Review (37.5). Child workspace Files (17.5, 18.6). `GroupCopiesPanel` and "From the organization" stop repeating (gap 31).
- [ ] Code editor button placement and read-only wording (24.2, 24.4).
- [ ] Image import from workspaces respects Admins-only folders (38.1 #6).

## Step 9 — Settings

**Report:** 22.1–22.6 (22.1, 22.2, 22.3, 22.4, 22.5, 22.6), 7.12, 6, 9, 16.8, 17.8, 18.1, 18.7, 19.1, 19.2, 27.1, 27.4–27.9, 29.1, 29.2, 29.3, 30.6, 33.5, 42.7, 42.17, 45.1, 45.2, 45.7.
**Decisions:** 12, 20, 23, 28, 29, 30, 35, 36, 55, 56, 65, 82, 132, 170, 176.
**Problems:** smaller bugs S7, S24.
- [ ] The menu and every field in section 22 (decisions 35 and 36, gaps 58 and 59, C2). Members, Stages, Task completion and member upload controls are removed. One review setting in Work. Admin emails under Notifications (30.6, gap 5 of §20).
- [ ] The Storage section with recommendations and By workspace (7.12, decision 12, section 14). Team storage stays separate, at 2 GB inside an organization (19.2, decision 30).
- [ ] Management: Leave moves here (decision 28). Delete chooses for each workspace separately and always keeps other people's (19.1, decision 29). Archive and Unarchive (27.5, gap 39). Transfer (27.6, gap 40). Duplicate for the next term (27.4, gap 38) — **my call:** the report gives Duplicate's screen no step, so it goes in this step. Files attached to assignments and sprint materials come along on Duplicate (42.7, smaller bug 7, decision 132).
- [ ] Verified badge changes, rechecked on website or name change (27.9, decision 56, gap 43). Names and handles (27.8, gap 42). Suspended and deleting states (27.7, gap 41).
- [ ] Moderation: Standing and Blocked people (29.2, 29.3, 29.6, decision 65, gap 8 of §20) — **my call:** the whole moderation section goes here. Trust and safety: reports on organization content go to admins, then staff, as built (9). The `OrgReportsSection` moves under Moderation (22.4).
- [ ] Account deletion: an owner is blocked until they transfer, as built, and the block shows a clear path to Transfer (9, 30.7).
- [ ] Term summary (33.5, 33.8 "High").
- [ ] Child workspace Settings: following can be changed after creation, visibility in one section, no random address endings (17.8, 18.7, gaps 36, 40 and 41).
- [ ] Smaller bug 24: Max members can't be saved below the current count.
- [ ] Ask to take over (45.2, decision 170, DB12). Export progress and Download all in the Archive and Delete dialogs (45.7, decision 176).

**DB:** DB12. A cache may be added (section 12). **Tests:** `organizations-settings.test.ts`, `organizations-lifecycle.test.ts`.

## Step 10 — Documents

**Report:** 7.4, 16.5, 17.6, 18.1, 18.5, 28.1, 28.4, 37.1, 37.4.
**Decisions:** 19, 20, 23, 58, 101.
- [ ] One list (16.5). Documents have Draft, Published and Unpublished changes; telling members is off by default (37.4, decision 101).
- [ ] Read counts (28.4, decision 58), required reading, groups, history and templates (gaps 52 and 53 of §20). The 7.4 templates are optional (section 14).
- [ ] Empty documents never reach visitors. Check child workspaces' starter documents (gap 9 of §11, 18.5).

## Step 11 — Workspaces and Members

**Report:** 7.9, 7.10, 16.8, 17.9–17.11 (17.10, 17.11), 24.3, 25.1, 25.3–25.8, 26.1, 26.4, 26.5, 26.8, 28.1, 28.6–28.8, 29.4, 29.6, 30.7, 31.4, 32.4, 33.5, 35.1, 35.2–35.5 (35.3), 36.1, 36.2–36.6, 41.4, 42.10, 42.17.
**Decisions:** 19, 20, 45, 46, 51, 57, 60, 63, 68, 72, 76, 82, 83, 91, 92, 94, 97, 138, 159.
**Problems:** P17, P53.
- [ ] Workspaces tab layout, Requests (move-in and leave, gaps 55 and 66 of §20), the Assign dialog, Unarchive (decision 91), and row actions (35.5, 35.6). Creating a workspace (35.2, 17.9). A workspace with no lead: admins assign one only when there's none (35.4, decision 92).
- [ ] One Teams screen, open seats on the tab, the seat check on bulk Add, Move to another workspace, and up to 10 seats per team (25.3, 25.6, decision 45, gaps 21 and 24).
- [ ] Ask to change team goes to admins (25.5, decision 46, gap 23). Team moves offer to move open team tasks too (42.10, decision 138, problem 17).
- [ ] Team mentions (25.8, gap 26) — **my call:** the report gives this no step, so it goes here with Teams.
- [ ] Members: the member panel and flags (28.7, gap 56), Remind (28.8, gap 57), verified status and filter (31.4, decision 72, gap 61), the expired invite row, the banner wording and join request notes (26.4, 26.5, gaps 29 and 30), and the admin list (29.6). Ticked people clear when the filter changes (smaller bug 9 is in 1b).
- [ ] Role dialog and its effects on copies (36.2, decision 94), Outside actions (36.3), Former with who ended it and the reason (36.4, decision 97), the Remove dialog showing consequences (36.5, gap 12). Viewers (26.8, decision 51, gap 33).
- [ ] Problem 53: organization admins see Organization and Members and teams in a workspace's Settings (decision 159).
- [ ] Export progress: a CSV of statuses and dates, never submission content (33.5, decision 83). My work's Invitations becomes Requests (30.7, decision 68).
- [ ] Live updates on Members requests (32.4). Workspace and member notices (30.8). "X left" gets its own setting (gap 23 of §11). Leaving moments in Messages follow 30.3 (built in step 14).
- [ ] The GitHub status line for the team (24.4 "Child workspace steps") — **my call:** it goes here with the workspace rows.

**Tests:** `organizations-members.test.ts`, `organizations-units.test.ts`, `organizations-children.test.ts`, `organizations-workspace.test.ts`.

## Step 12 — Sprints

**Report:** 5.6, 7.6, 16.2, 17.3, 18.1, 18.2, 28.1, 28.2, 33.4, 37.1, 37.2, 42.1, 42.3, 42.5, 42.6, 42.7, 42.10, 42.11, 42.18.
**Decisions:** 8, 9, 19, 20, 23, 24, 59, 99, 120, 122, 123, 131, 132, 137.
**Problems:** P3; smaller bugs S7, S14.
- [ ] One sprint form with Repeat; Plan a series moves into it; Create linked sprint goes (16.2, decisions 9 and 24). Its empty state has one main button (gap 30).
- [ ] Linked sprint dates stay within the organization sprint, default dates work, the "Not part of an organization sprint" wording is fixed, and the team sprint follows CO1's dates (17.3, 18.1, 18.2; gaps 29, 34, 35 and 42).
- [ ] The Repeat preview, and Move later sprints, with no series record (28.2, decision 59, gap 49 of §20).
- [ ] Problem 3 and sprint handover: in the existing hourly job, for organization sprints only, the current sprint completes with nothing moved, the next one starts, and admins get the summary (42.6, decisions 122 and 123). A normal workspace's sprint still waits for Complete (42.18 #1, a new test).
- [ ] The sprint summary (33.8 "Essential"). Menus, dialogs, Materials, Workspaces panel (37.2). Cancel and Archive; Duplicate sprint goes (decision 99).
- [ ] Plan your sprint offers the workspace's group copies (42.5, decision 131). Sprint materials on Duplicate (42.7, 132).
- [ ] The material picker warns about Admins-only files (42.10, decision 137). Smaller bug 14: Plan a series suggests the type's name ("CO" for Education).
- [ ] Normal sprints get database tests (42.18 #4).

**Tests:** `organizations-sprints.test.ts`, `organizations-sprint-pass.test.ts`, and a new normal-workspace sprint database test.

## Step 13 — Tasks (largest; its own plan)

**Report:** 5.6, 7.7, 10.2, 16.1, 17.4, 18.1, 18.3, 23.1–23.7, 24.2, 25.7, 29.1, 29.3, 30.7, 32.4, 32.5, 32.7, 33.5, 34.1, 34.3–34.7, 36.6, 42.1, 42.3, 42.5, 42.11, 42.12, 42.13, 42.14, 44.3, 45.1, 45.3.
**Decisions:** 6, 8, 10, 14, 15, 16, 17, 19, 20, 23, 25, 38, 39, 40, 47, 64, 68, 74, 76, 78, 82, 83, 85, 88, 89, 98, 113, 120, 125, 126, 127, 128, 139, 148, 166, 168, 171.
**Problems:** P8, P9, P10, P19, P33; smaller bugs S18, S19.
- [ ] One task form and one board holding both; "Assignment" stays a chip; the button is "New task" (16.1, decisions 6, 10 and 25). Students see only their own copy (decision 15, gap 22). Assignment cards show class progress (gap 24).
- [ ] The state and role tables in 42.13 are the full rules (decision 148). One lifecycle each (42.3, decision 120). Problem 33: the badge and the In review filter agree. Smaller bug 19: the line above the board follows each assignment's review setting.
- [ ] Problem 19: organization admins can create, move, assign and add team tasks in a workspace, shown as `Viewing as admin` (decision 139).
- [ ] The review queue, bulk actions, keyboard keys and awkward cases (23.2, gap 45). Editing a published assignment field by field: steps only added after publishing, hand-in type locks at the first submission (23.3, decisions 39 and 40, gap 46). Custom columns (23.4, gap 47). Class questions and the private conversation (23.5, decision 16, gap 48).
- [ ] The Submit section in the task panel for every hand-in type, with an optional note (34.4, decision 85). The task form and who can use it (34.5). Roster dialogs and Give to (34.6, decisions 17 and 88). Team tasks in the one form (34.7, decision 89).
- [ ] Publish timing: Publish now, When the sprint starts, On a date, or Save as draft (42.5, decision 125). Fix by on Return, 3 days by default (decision 126, problem 8). The submission record table (decision 127, problem 9, DB9). Materials on the assignment, read through to the main assignment (decision 128, problem 10).
- [ ] Group assignments, and late joiners shown in the roster with admins told (25.7, decision 47, gap 25). Auto-made groups quietly avoid blocked pairs (29.3, decision 64).
- [ ] Use again and Export progress (33.5, 33.8 "High"). The "From" line falls back to the organization; drafts and the Today row (36.6, decision 98).
- [ ] Due dates entered in the organization's zone and shown in your own (32.5, decision 74). Live roster and queue (32.4, decision 76). The board on phones, with no swipe to approve (32.7, decision 78).
- [ ] New assignment notices, and My work's Submitted filter with Download (30.7, 30.8, decision 68).
- [ ] Smaller bug 18: Extend on a closed assignment asks "Reopen it for Asha?".
- [ ] Publishing shows progress, "Publishing to 1,999 people…", with the button disabled (44.3).
- [ ] Late after: a field in the due-date row, 15 minutes by default, 0 to 60 (45.3, decision 171, DB13).
- [ ] The scale test also counts the notices and emails one publish writes (decision 168).
- [ ] The temporary switch, while real classes are running (decisions 113 and 166).
- [ ] Child workspace Tasks: team assignment, and locked fields marked on the card (17.4, 18.3, gaps 37 and 38).
- [ ] A database test that normal review is unchanged (42.18 #5).

**DB:** DB9, DB13. **Tests:** `organizations-assignments.test.ts`, `organizations-assignment-pass.test.ts`, `organizations-scale.test.ts`, `task-discussion.test.ts`, `workspace-tasks-actions.test.ts`, and a new normal-review database test.

## Step D — Discover (small, separate)

**Report:** 31.1, 31.2, 31.6, 31.8.
**Decisions:** 70, 73.
- [ ] The organization card with type chip, member photos and workspace count; filters; the ✓; no Join button on cards (31.6, decisions 70 and 73, gap 63). A new organization appears after 3 members and 7 days (9).
- [ ] The rest of 31.2 — **my call:** the report places only the indexing rule (1a), so the rest goes here. That's the signed-out page landing on About, share previews by state, page titles "About · CSE 3B · NetworkBase", and the not-available page for organization-only child workspaces (gap 20 of §20).

**Tests:** `discover-updates.test.ts`, `check:discover`.

## Step 14 — Everywhere else and the final pass

**Report:** 7.13, 9, 16.11, 16.12, 30.2, 30.3, 30.4, 30.5, 31.7, 32.1, 32.2, 32.3, 32.6–32.8, 33.7, 34.2, 37.7, 37.8, 41.7, 42.7, 45.1, 45.3, 45.6.
**Decisions:** 75, 77, 84, 102, 103, 118, 164, 172, 175.
**Problems:** smaller bug S8.
- [ ] Messages (30.3, gap 2 of §20) — **my call:** the report gives Messages no step, and section 9 puts it under Everywhere else. `#general` and channels grouped under the organization, who sees what, the moments table, the 200-channel limit, and removal clearing everything.
- [ ] The rest of the notifications (30.4: wording, grouping, tray, push) and emails (30.5: templates, look, batching) not already shipped with their features (gaps 3 and 4 of §20).
- [ ] Top bar search and ⌘K: "Search this organization…", results grouped by kind, and the privacy rows (32.2, 9, gap 7 of §20).
- [ ] Network and person cards: the shared organization chip only for current members who show it (31.7, 9, gap 64).
- [ ] Only organizations and workspaces get the Share dialog; items inside get Copy link (37.7, decision 102). Followers get public posts in Discover only, with no notices by default and no list (37.8, decision 103).
- [ ] Every browser pop-up becomes the shared dialog (32.3, decision 75). A failed save always keeps what was written (32.6, decision 77). Full review of phones, dark mode and accessibility (32.7, 32.8, gaps 67 and 68). Consistency for members (7.13).
- [ ] Smaller bug 8: the sidebar stops running the full attention query and document reads on every load.
- [ ] Preview as member, read only, through the member read rules (45.6, decision 175).
- [ ] Everything connected (16.11). Walk every whole-life scenario in 16.12 and 33.7 as browser checks.
- [ ] The measures SQL file for 41.7, including emails waiting more than an hour (164) and failed hand-in uploads (172).

## Pilot

**Report:** 41.1, 44.7, decisions 114, 164, 165, 168.
**Decisions:** 114, 164, 165, 168.
- [ ] One college class of 30 to 60 for two weeks: one full sprint and at least two assignments, one with review and one with teams.
- [ ] Resend free plan for one class; buy Pro before a second class or any organization over 60 people (164). Inngest checked weekly; buy a paid plan before 5 active classes (165). Read real notice costs from the dashboards (168).
- [ ] Watch Sentry daily. Roll back at once on any privacy problem or lost work (41.5). The pilot finishes when there are no privacy or data-loss bugs, every serious bug is fixed, and the teacher would keep using it.

## Before opening up

**Report:** 41.9, 45.8, decision 177.
**Decisions:** 164, 165, 167, 177.
- [ ] The landing page section "For classes and teams", and the help page "Running a class on NetworkBase", linked from the Ready screen and the empty Overview.
- [ ] The Privacy Policy section reviewed by a lawyer and published; `check:legal-readiness` passes (167).
- [ ] Browser tests pass, plus the signed-in and two-browser checks (41.9).
- [ ] Resend and Inngest plans bought at their trigger points (164, 165).

## After the pilot

**Decisions:** 82, 172. **DB:** DB7.

- [ ] Away, Catch up and Reviewers (33.5, 33.8 "Medium", decision 82; DB7).
- [ ] Resumable uploads, only if the pilot showed failed hand-ins (decision 172).

## Later

**Decisions:** 82.

- [ ] Repeat assignment, and Calendar with a private link token (33.5, 33.8 "Later", decision 82; 41.2 "Later").

---

## Appendix A — Decisions 1–177 → step

| # | Step |
|---|---|
| 1 | 2 |
| 2 | 2 |
| 3 | 2 |
| 4 | 2 |
| 5 | 1a, 7 |
| 6 | 13 |
| 7 | 4 |
| 8 | 7, 8, 12, 13 |
| 9 | 12 |
| 10 | 13 |
| 11 | 8 |
| 12 | 8, 9 |
| 13 | 2 |
| 14 | 1b, 13 |
| 15 | 1a, 13 |
| 16 | 1a, 13 |
| 17 | 13 |
| 18 | No build (scheduled posts left out) |
| 19 | 2, 4, 5, 7, 8, 10, 11, 12, 13 |
| 20 | 3, 4, 7, 8, 9, 10, 11, 12, 13 |
| 21 | 4 |
| 22 | 3 |
| 23 | 7, 8, 9, 10, 12, 13 |
| 24 | 12 |
| 25 | 13 |
| 26 | 1b |
| 27 | 1a, 7 |
| 28 | 9 |
| 29 | 9 |
| 30 | 9 |
| 31 | 1b |
| 32 | T |
| 33 | T, every tab step |
| 34 | T, 6, every tab step |
| 35 | 9 |
| 36 | 9 |
| 37 | 1a |
| 38 | 1b, 13 |
| 39 | 13 |
| 40 | 13 |
| 41 | 1a |
| 42 | 1b, 8 |
| 43 | 1b |
| 44 | 1d, 3 |
| 45 | 1b, 11 |
| 46 | 11 |
| 47 | 13 |
| 48 | 2 |
| 49 | 4 |
| 50 | 1b |
| 51 | 6, 11 |
| 52 | 1b |
| 53 | 1a |
| 54 | 4 |
| 55 | 1d, 9 |
| 56 | 9 |
| 57 | 1c, 11 |
| 58 | 7, 10 |
| 59 | 12 |
| 60 | 1c, 11 |
| 61 | 8 |
| 62 | 1a |
| 63 | 6, 11, 1d |
| 64 | 13 |
| 65 | 9 |
| 66 | 1c |
| 67 | 7 |
| 68 | 11, 13 |
| 69 | 1a |
| 70 | 4, D |
| 71 | 2 |
| 72 | 11 |
| 73 | D |
| 74 | 1c, 13 |
| 75 | 1d, 14 |
| 76 | 4, 11, 13 |
| 77 | Every tab step, 14 |
| 78 | 13 |
| 79 | 4, 5 |
| 80 | 4 |
| 81 | 4 |
| 82 | 4, 9, 11, 13, After the pilot, Later |
| 83 | 11, 13 |
| 84 | 3, 14 |
| 85 | 1b, 13 |
| 86 | 1b |
| 87 | 1b |
| 88 | 13 |
| 89 | 13 |
| 90 | 1b |
| 91 | 11 |
| 92 | 11 |
| 93 | 1c |
| 94 | 11 |
| 95 | 1a |
| 96 | 1b |
| 97 | 2, 11 |
| 98 | 13 |
| 99 | 12 |
| 100 | 7 |
| 101 | 10 |
| 102 | 14 |
| 103 | 1a, 14 |
| 104 | 1b |
| 105 | 2 |
| 106 | 1b |
| 107 | 2 |
| 108 | 1d, 3 |
| 109 | T, every tab step |
| 110 | 1d, 3 |
| 111 | Every tab step |
| 112 | 1a, 1b, 1c, 1d |
| 113 | 13 |
| 114 | Pilot |
| 115 | Every step |
| 116 | Every step |
| 117 | 1a, 1c |
| 118 | 14 |
| 119 | Every step |
| 120 | 1b, 12, 13 |
| 121 | 1a, 1b |
| 122 | 12 |
| 123 | 12 |
| 124 | 1b |
| 125 | 13 |
| 126 | 13 |
| 127 | 1b, 13 |
| 128 | 13 |
| 129 | 1b |
| 130 | 1b |
| 131 | 12 |
| 132 | 9, 12 |
| 133 | 1b |
| 134 | 1b |
| 135 | 1b |
| 136 | 1b |
| 137 | 1a, 12 |
| 138 | 11 |
| 139 | 13 |
| 140 | 1b |
| 141 | 1b |
| 142 | 1b, 1c |
| 143 | 1b |
| 144 | 1a, 1b |
| 145 | 1a |
| 146 | 1b |
| 147 | 1b |
| 148 | 13 |
| 149 | 1a |
| 150 | 1b |
| 151 | 1b |
| 152 | 1a, 7 |
| 153 | 1a |
| 154 | 1b |
| 155 | 1b |
| 156 | 1b |
| 157 | 1b |
| 158 | 1b |
| 159 | 11 |
| 160 | 1b |
| 161 | Every step |
| 162 | Every step |
| 163 | 1d |
| 164 | 14, Pilot, Before opening up |
| 165 | Pilot, Before opening up |
| 166 | 0, 1a, 1b, 1c, 13 |
| 167 | 1d, Before opening up |
| 168 | 13, Pilot |
| 169 | No build (confirms 122, 139, 146, 149–151, 157) |
| 170 | 9 |
| 171 | 13 |
| 172 | 14, After the pilot |
| 173 | 1b |
| 174 | 1c |
| 175 | 14 |
| 176 | 9 |
| 177 | Before opening up |

## Appendix B — Core workflow problems and smaller bugs → step

| ID | Step |
|---|---|
| P1 | 1a |
| P2 | 1b |
| P3 | 12 |
| P4 | 1b |
| P5 | 1b |
| P6 | 1b |
| P7 | 1b |
| P8 | 13 |
| P9 | 13 |
| P10 | 13 |
| P11 | 1b |
| P12 | 1b |
| P13 | 1b |
| P14 | 1b |
| P15 | 1b |
| P16 | 1a |
| P17 | 11 |
| P18 | 1b |
| P19 | 13 |
| P20 | 1b |
| P21 | 1b |
| P22 | 1b |
| P23 | 1b |
| P24 | 1a |
| P25 | 1b |
| P26 | 1b |
| P27 | 1c |
| P28 | 1a |
| P29 | 1b |
| P30 | 1a |
| P31 | 1b |
| P32 | 1b |
| P33 | 13 |
| P34 | 1b |
| P35 | 1b |
| P36 | 1b |
| P37 | 1a |
| P38 | 1b |
| P39 | 1b |
| P40 | 1a |
| P41 | 1a |
| P42 | 1b |
| P43 | 1b |
| P44 | 1a |
| P45 | 1b |
| P46 | 1b |
| P47 | 1b |
| P48 | 1b |
| P49 | 1a |
| P50 | 1b |
| P51 | 1b |
| P52 | 1b |
| P53 | 11 |
| S1 | 1b |
| S2 | 1c |
| S3 | 1b |
| S4 | 1b |
| S5 | 1b |
| S6 | 1b |
| S7 | 9, 12 |
| S8 | 14 |
| S9 | 1b |
| S10 | 1b |
| S11 | Withdrawn (database already refuses it) |
| S12 | 1d |
| S13 | 3 |
| S14 | 12 |
| S15 | 1b |
| S16 | 1b |
| S17 | 1b |
| S18 | 13 |
| S19 | 13 |
| S20 | 1d |
| S21 | 7 |
| S22 | 1b |
| S23 | Withdrawn (44.3: preview checks access on every request) |
| S24 | 9 |

## Appendix C — Gaps and conflicts → step

**Section 11 gaps (G11-n):**

| ID | Step |
|---|---|
| G11-1 | 2 |
| G11-2 | 2 |
| G11-3 | 2 |
| G11-4 | 6 |
| G11-5 | 5 |
| G11-6 | 5 |
| G11-7 | 4 |
| G11-8 | 7 |
| G11-9 | 10 |
| G11-10 | 1a, 7 |
| G11-11 | 2 |
| G11-12 | 11 |
| G11-13 | 4 |
| G11-14 | 6 |
| G11-15 | 4 |
| G11-16 | 4 |
| G11-17 | 3 |
| G11-18 | 8, 9 |
| G11-19 | 7 |
| G11-20 | 7 |
| G11-21 | 5 |
| G11-22 | 1a, 13 |
| G11-23 | 11 |
| G11-24 | 13 |
| G11-25 | 3 |
| G11-26 | 3 |
| G11-27 | 3 |
| G11-28 | 3 |
| G11-29 | 12 |
| G11-30 | 12 |
| G11-31 | 8, 13 |
| G11-32 | 4, 9 |
| G11-33 | 1a, 7 |
| G11-34 | 12 |
| G11-35 | 12 |
| G11-36 | 9, 12 |
| G11-37 | 13 |
| G11-38 | 1b, 13 |
| G11-39 | 7 |
| G11-40 | 9 |
| G11-41 | 9 |
| G11-42 | 12 |

**Section 20 gaps (G20-n) and conflicts (C):**

| ID | Step |
|---|---|
| G20-1 | T |
| G20-2 | 14 |
| G20-3 | Each tab step, 14 |
| G20-4 | Each tab step, 14 |
| G20-5 | 9 |
| G20-6 | 11, 13 |
| G20-7 | 14 |
| G20-8 | 9 |
| G20-9 | 9, 13 |
| G20-10 | T |
| G20-11 | T |
| G20-12 | 1d, 14 |
| G20-13 | 4, 11, 13 |
| G20-14 | 1c, 13 |
| G20-15 | Each tab step, 14 |
| G20-16 | 1a, 1d, 6, 11 |
| G20-17 | Rollout rules (every deploy) |
| G20-18 | 14 |
| G20-19 | Every deploy |
| G20-20 | 1a, D |
| G20-21 | 11 |
| G20-22 | 1b, 11 |
| G20-23 | 11 |
| G20-24 | 11 |
| G20-25 | 13 |
| G20-26 | 11 |
| G20-27 | 6 |
| G20-28 | 6 |
| G20-29 | 11 |
| G20-30 | 11 |
| G20-31 | 6 |
| G20-32 | 4 |
| G20-33 | 11 |
| G20-34 | 2 |
| G20-35 | 2, 9 |
| G20-36 | 1d |
| G20-37 | 1d |
| G20-38 | 1b, 9 |
| G20-39 | 9 |
| G20-40 | 1b, 9 |
| G20-41 | 1a, 4, 9 |
| G20-42 | 1d, 9 |
| G20-43 | 9 |
| G20-44 | 13 (superseded by 44.3: progress state added) |
| G20-45 | 13 |
| G20-46 | 13 |
| G20-47 | 13 |
| G20-48 | 13 |
| G20-49 | 12 |
| G20-50 | 7 |
| G20-51 | 7 |
| G20-52 | 10 |
| G20-53 | 10 |
| G20-54 | 8 |
| G20-55 | 1c, 11 |
| G20-56 | 11 |
| G20-57 | 11 |
| G20-58 | 9 |
| G20-59 | 9 |
| G20-60 | 2 |
| G20-61 | 11 |
| G20-62 | 1d |
| G20-63 | D |
| G20-64 | 14 |
| G20-65 | 1a, 1b, 8, 13 |
| G20-66 | 11 |
| G20-67 | Each tab step, 14 |
| G20-68 | Each tab step, 14 |
| C1 | 1b, 13 |
| C2 | 9 |
| C3 | T |
| C4 | No build (report structure only) |
| C5 | T, 6 |
| C6 | T |

## Appendix D — Database changes (41.2) → step

| ID | Change | Step |
|---|---|---|
| DB1 | Last active here on each membership | 1a |
| DB2 | `end_reason`, who ended it, the written reason | 2 |
| DB3 | Fill saved type settings for existing organizations | T |
| DB4 | Welcome panel dismissed | 4 |
| DB5 | Write-up nudge dismissed | 2 |
| DB6 | Hide from organization, on the post | 7 |
| DB7 | Away table and Reviewers field | After the pilot |
| DB8 | `nb_task_visible` hides drafts from members | 1a |
| DB9 | Submission record table | 13 |
| DB10 | Live update rule for copies | 1a |
| DB11 | Read-only guard covers edits to posts and comments | 1b |
| DB12 | Take-over request on the organization | 9 |
| DB13 | Late after, in minutes, on the main assignment | 13 |

To confirm at build time: `assignments.reminded` and `org.team_changed` (1c). Indexes only if the measurements call for them. Calendar's link token is in Later.

## Appendix E — "How this gets built" rows → step

Every row of every build table in the report, with its step here.

| Report row | Step |
|---|---|
| 21.5 Step 1: group work locks via permissions table | 1b |
| 21.5 Before the tab steps: type profile, the eight checks, saved settings fill | T |
| 21.5 With each tab step: permission checks and limits | Every tab step |
| 23.6 Step 1: comment privacy; drag block | 1a; 1b |
| 23.6 Tasks step: everything else | 13 |
| 24.4 Step 1: visibility rule; editor member locks; attachment task check; copies out of publish-and-complete | 1a; 1b |
| 24.4 Files and Tasks steps: button placement, read-only wording | 8, 13 |
| 24.4 Child workspace steps: GitHub status line | 11 |
| 25.9 Step 1: placing accepted applicants; outside-people check | 1b |
| 25.9 Tasks step: group assignments, late joiners | 13 |
| 25.9 Workspaces and Members step: Teams screen, open seats, seat check, Move, Requests row | 11 |
| 26.11 Step 1: rejoin fix; 50-organization limit | 1b |
| 26.11 Step 2: private page states, leave dialog | 2 |
| 26.11 Members step: expired invite row, banner wording, join request notes | 11 |
| 26.11 Overview step: welcome panel | 4 |
| 27.10 Step 1: duplicate dates; suspension reasons; owner limit on transfer; wizard limit check | 1b; 1a; 1b; 1b |
| 27.10 Settings step: Transfer, Archive, Verified | 9 |
| 27.10 Overview step: term-end prompt, archived states | 4 |
| 27.10 Alongside step 1's wording fixes: wizard and ready screen | 1d |
| 28.9 Step 1: move-in Approve and Decline; inactive rule | 1c |
| 28.9 Sprints step: Repeat preview, Move later sprints | 12 |
| 28.9 Updates step: Seen counts, email counter, at-limit message | 7 |
| 28.9 Documents step: Read counts | 10 |
| 28.9 Files step: template and size messages | 8 |
| 28.9 Workspaces and Members step: Requests row, member panel, Remind | 11 |
| 29.6 Step 1a: Last active here | 1a |
| 29.6 Settings step: Standing and Blocked people | 9 |
| 29.6 Tasks step: auto-made groups avoiding blocks | 13 |
| 29.6 Overview step: restricted notice | 4 |
| 29.6 Members step: join page line, admin list | 6, 11 |
| 29.6 Before launch: Privacy Policy section | 1d (draft), Before opening up |
| 30.8 Step 1: two new event types | 1c |
| 30.8 Updates step: email counter, at-limit message | 7 |
| 30.8 Tasks step: assignment notices, My work's Submitted | 13 |
| 30.8 Members and Workspaces steps: their notices | 11 |
| 30.8 Later steps: the rest of the notices | Each tab step, 14 |
| 31.8 Step 1: plus button; indexing rule | 1d; 1a |
| 31.8 Overview step: ✓ on the header | 4 |
| 31.8 Members step: verified status and filter | 11 |
| 31.8 Discover step: card, filters, ✓ | D |
| 31.8 Step 2: Workspaces section | 2 |
| 31.8 Alongside step 1's fixes: remaining sidebar rows | 1d |
| 32.9 Step 1: wrong-day fix; focus ring | 1c; 1d |
| 32.9 Tasks step: due dates, live roster and queue, board on phones | 13 |
| 32.9 Each tab step: failure states, phone, dark, `axe` | Every tab step |
| 32.9 Overview and Members steps: live updates | 4, 11 |
| 32.9 Step 14: search privacy rows, full phones/dark/accessibility review | 14 |
| 33.8 Essential: Today, This week, How the class is doing, sprint-ending row, sprint summary | 4, 12 |
| 33.8 High: Use again, Export progress, Close-out list, Term summary | 13, 11, 4, 9 |
| 33.8 Medium: Away, Catch up, Reviewers | After the pilot |
| 33.8 Later: Repeat assignment, Calendar | Later |
| 34.8 Step 1: Returned visible, approved locked, member-created tasks refused | 1b |
| 34.8 Tasks step: Submit section, task form, roster dialogs, Give to, team tasks | 13 |
| 34.8 Everywhere: status words, visitor tab table | 3, 14 |
| 35.6 Step 1: delete block with handed-in work; archive notice | 1b; 1c |
| 35.6 Workspaces and Members step: layout, Requests, Assign, Unarchive, row actions | 11 |
| 35.6 Alongside step 1's wording fixes: wizard changes | 1d |
| 36.7 Step 1: nobody reviews their own work | 1a |
| 36.7 Step 2: who ended it, the reason | 2 |
| 36.7 Workspaces and Members step: role dialog, Outside actions, Former, Remove dialog | 11 |
| 36.7 Tasks step: "From" fallback, drafts, Today row | 13 |
| 37.9 Sprints step: menus, dialogs, Materials, Workspaces panel | 12 |
| 37.9 Updates step: card actions, audience, Hide | 7 |
| 37.9 Documents step: states, Publish dialog | 10 |
| 37.9 Files step: pages, Trash, in-use warning, Review | 8 |
| 37.9 Step 3: tab bar | 3 |
| 37.9 Final pass: sharing and followers | 14 |
| 38.10 Step 1: locked dates and role; Start from my work | 1b |
| 38.10 Step 2: Manage organizations, editor, history, publishing, nudges, who sees | 2 |
| 39.5 Step 1: role-change notice wording; terminology check | 1c; 1d |
| 39.5 Each step: server checks to the table, notices | Every tab step |
| 39.5 Step 3: role-word helper | 3 |
| 42.7 rows (1a P1; 1b P2, P4–P7, S1, S3–S6; 1c S2; Sprints P3, Plan your sprint, materials on Duplicate; Tasks publish timing, Fix by, submission record, materials; Settings files on Duplicate; Final pass S8) | As in Appendix B, 12, 13, 9, 14 |
| 42.10 rows (1a Admins-only names; 1b P11–P15, P18, S9–S11; Sprints picker warning; Workspaces and Members team moves; 1d S12) | 1a, 1b, 12, 11, 1d |
| 42.11 rows (Tasks P19; Sprints S14; Step 3 S13) | 13, 12, 3 |
| 42.12 rows (1a P24, P28; 1b P20–P23, P25, P26, S15–S17; 1c P27; Tasks S18) | 1a, 1b, 1c, 13 |
| 42.13 rows (1a P30; 1b P29, P31, P32, P34; Tasks P33, S19, both tables) | 1a, 1b, 13 |
| 42.14 rows (1a P37; 1b P35, P36, P38, P39) | 1a, 1b |
| 42.15 rows (1a P40, P41, P44, P49; 1b P42, P43, P45–P48, S22; 1d S20; Updates S21, composer) | 1a, 1b, 1d, 7 |
| 42.16 rows (1b P50, P51; Files 7.8, 37.5) | 1b, 8 |
| 42.17 rows (1b P52; Workspaces and Members P53; Settings S24, section 22) | 1b, 11, 9 |
| 45.9 rows (task push 1b; deleted-account notice 1c; take over and records 9; Late after 13; Preview as member 14; landing and guide; resumable uploads) | 1b, 1c, 9, 13, 14, Before opening up, After the pilot |
| Section 12 rows (1a … Later) | Steps of the same names |

## Appendix F — Every report subsection → step

Process-only sections are marked; everything else is built in the step shown.

| Sec | Step |
|---|---|
| 1 | Global Constraints |
| 2 | Global Constraints |
| 3 | Global Constraints |
| 4.1 | 2 |
| 4.2 | 2 |
| 4.3 | 2 |
| 4.4 | 2 |
| 4.5 | 2 |
| 4.6 | 2 |
| 4.7 | 2 |
| 5.1 | 3 |
| 5.2 | 3 |
| 5.3 | 3 |
| 5.4 | 3 |
| 5.5 | 6 |
| 5.6 | 12, 13 |
| 5.7 | 3 |
| 6 | 4, 9 |
| 7.1 | 3 |
| 7.2 | 4 |
| 7.3 | 5 |
| 7.4 | 10 |
| 7.5 | 7 |
| 7.6 | 12 |
| 7.7 | 13 |
| 7.8 | 8 |
| 7.9 | 11 |
| 7.10 | 11 |
| 7.11 | 6 |
| 7.12 | 9 |
| 7.13 | 14 |
| 8 | Points to 17 and 18 |
| 9 | 14 (sidebar 1d, Discover D, account deletion 1c) |
| 10.1 | 2 |
| 10.2 | 3, 6, 13 |
| 10.3 | T, every step |
| 10.4 | Every step (Measure) |
| 10.5 | 0, every step |
| 11 | Appendix C |
| 12 | This plan's step order |
| 13 | Appendix A |
| 14 | Calls the owner can still correct; built as written in 2, 4, 6, 8, 9, 10 |
| 15 | Builder's choices |
| 16.1 | 13 |
| 16.2 | 12 |
| 16.3 | 7 |
| 16.4 | 8 |
| 16.5 | 10 |
| 16.6 | 4 |
| 16.7 | 5 |
| 16.8 | 9, 11 |
| 16.9 | 2 |
| 16.10 | 2 |
| 16.11 | 14 |
| 16.12 | 14 (scenario checks) |
| 16.13 | 3 |
| 17 | Ships with the matching tab step |
| 17.1 | 3 |
| 17.2 | 4 |
| 17.3 | 12 |
| 17.4 | 13 |
| 17.5 | 8 |
| 17.6 | 10 |
| 17.7 | 7 |
| 17.8 | 9 |
| 17.9 | 1d, 11 |
| 17.10 | 11 |
| 17.11 | 11 |
| 18.1 | 7, 8, 9, 10, 12, 13 |
| 18.2 | 12 |
| 18.3 | 13 |
| 18.4 | 7 |
| 18.5 | 10 |
| 18.6 | 8 |
| 18.7 | 9 |
| 19.1 | 9 |
| 19.2 | 9 |
| 19.3 | 1b |
| 20.1 | Appendix C |
| 20.2 | Appendix C |
| 20.3 | Appendix C |
| 20.4 | Appendix C |
| 20.5 | Appendix C |
| 20.6 | Appendix C |
| 20.7 | Appendix C |
| 20.8 | Appendix C |
| 21.1 | T |
| 21.2 | T |
| 21.3 | T, every tab step |
| 21.4 | T, every tab step |
| 21.5 | T |
| 22.1 | 9 (#7 in 1b) |
| 22.2 | 9 |
| 22.3 | 9 |
| 22.4 | 9 |
| 22.5 | 9 |
| 22.6 | 9 |
| 23.1 | 13 |
| 23.2 | 13 |
| 23.3 | 13 |
| 23.4 | 1b, 13 |
| 23.5 | 1a, 13 |
| 23.6 | Appendix E |
| 23.7 | Left out |
| 24.1 | 1a, 1b |
| 24.2 | 1b, 8, 13 |
| 24.3 | 1a, 1b, 11 |
| 24.4 | Appendix E |
| 24.5 | Calls |
| 24.6 | Left out |
| 25.1 | 11 |
| 25.2 | 1d, 3 |
| 25.3 | 11 |
| 25.4 | 1a, 1b |
| 25.5 | 11 |
| 25.6 | 11 |
| 25.7 | 13 |
| 25.8 | 11 |
| 25.9 | Appendix E |
| 25.10 | Calls |
| 25.11 | Left out |
| 26.1 | 1b, 2, 4, 6, 11 |
| 26.2 | 6 |
| 26.3 | 6 |
| 26.4 | 11 |
| 26.5 | 11 |
| 26.6 | 6 |
| 26.7 | 4 |
| 26.8 | 11 |
| 26.9 | 2 |
| 26.10 | 2 |
| 26.11 | Appendix E |
| 26.12 | Calls |
| 26.13 | Left out |
| 27.1 | 1a, 1b, 1d, 4, 9 |
| 27.2 | 1d |
| 27.3 | 1d |
| 27.4 | 1b, 9 |
| 27.5 | 4, 9 |
| 27.6 | 1b, 9 |
| 27.7 | 1a, 9 |
| 27.8 | 1d, 9 |
| 27.9 | 9 |
| 27.10 | Appendix E |
| 27.11 | Calls |
| 27.12 | Left out |
| 28.1 | 7, 8, 10, 11, 12, 1c |
| 28.2 | 12 |
| 28.3 | 7 |
| 28.4 | 10 |
| 28.5 | 8 |
| 28.6 | 1c, 11 |
| 28.7 | 1c, 11 |
| 28.8 | 1c, 11 |
| 28.9 | Appendix E |
| 28.10 | Calls |
| 28.11 | Left out |
| 29.1 | 1a, 9, 13 |
| 29.2 | 9 (entry points per tab step), 1d (under-18 option) |
| 29.3 | 9, 13 |
| 29.4 | 1a, 6, 11, 1d |
| 29.5 | 1d (decided, 163) |
| 29.6 | Appendix E |
| 29.7 | Calls |
| 29.8 | Left out |
| 30.1 | Corrections applied in every step |
| 30.2 | 14 |
| 30.3 | 14 |
| 30.4 | 1c, each tab step, 14 |
| 30.5 | 7, 14 |
| 30.6 | 9 |
| 30.7 | 11, 13 |
| 30.8 | Appendix E |
| 30.9 | Calls |
| 30.10 | Left out |
| 31.1 | 1a, D |
| 31.2 | 1a, D |
| 31.3 | 2 |
| 31.4 | 11 |
| 31.5 | 1d |
| 31.6 | D |
| 31.7 | 14 |
| 31.8 | Appendix E |
| 31.9 | Calls |
| 31.10 | Left out |
| 32.1 | 14 |
| 32.2 | 14 |
| 32.3 | 1d, 14 |
| 32.4 | 4, 11, 13 |
| 32.5 | 1c, 13 |
| 32.6 | Every tab step, 14 |
| 32.7 | Every tab step, 13, 14 |
| 32.8 | Every tab step, 14 |
| 32.9 | Appendix E |
| 32.10 | Calls |
| 32.11 | Left out |
| 33.1 | 4 |
| 33.2 | 4, 5 |
| 33.3 | 4 |
| 33.4 | 4, 12 |
| 33.5 | 4, 9, 11, 13, After the pilot, Later |
| 33.6 | 4 |
| 33.7 | 14 (scenario checks) |
| 33.8 | Appendix E |
| 33.9 | Calls |
| 33.10 | Left out |
| 34.1 | 1b, 13 |
| 34.2 | 3, 14 |
| 34.3 | 13 |
| 34.4 | 1b, 13 |
| 34.5 | 1b, 13 |
| 34.6 | 13 |
| 34.7 | 13 |
| 34.8 | Appendix E |
| 34.9 | Calls |
| 34.10 | Left out |
| 35.1 | 11 |
| 35.2 | 1d, 11 |
| 35.3 | 1b, 1c, 11 |
| 35.4 | 11 |
| 35.5 | 11 |
| 35.6 | Appendix E |
| 35.7 | Calls |
| 35.8 | Left out |
| 36.1 | 11 |
| 36.2 | 1a, 11 |
| 36.3 | 1b, 11 |
| 36.4 | 2, 11 |
| 36.5 | 11 |
| 36.6 | 1b, 13 |
| 36.7 | Appendix E |
| 36.8 | Calls |
| 36.9 | Left out |
| 37.1 | 7, 8, 10, 12 |
| 37.2 | 12 |
| 37.3 | 7 |
| 37.4 | 10 |
| 37.5 | 8 |
| 37.6 | 3 |
| 37.7 | 14 |
| 37.8 | 14 |
| 37.9 | Appendix E |
| 37.10 | Calls |
| 37.11 | Left out |
| 38.1 | 1b, 2, 8 |
| 38.2 | 2 |
| 38.3 | 1b, 2 |
| 38.4 | 1b, 2 |
| 38.5 | 2 |
| 38.6 | 2 |
| 38.7 | 1b |
| 38.8 | 1b |
| 38.9 | 2 |
| 38.10 | Appendix E |
| 38.11 | Calls |
| 38.12 | Left out |
| 39.1 | Corrections applied in every step |
| 39.2 | T, every tab step |
| 39.3 | Every tab step |
| 39.4 | 1d, 3 |
| 39.5 | Appendix E |
| 39.6 | Calls |
| 39.7 | Left out |
| 40.1 | Every tab step (look) |
| 40.2 | Every tab step |
| 40.3 | Calls |
| 40.4 | Left out |
| 41.1 | Ship rules, every deploy |
| 41.2 | Appendix D |
| 41.3 | 1a, 1b, 1c, 1d |
| 41.4 | 1a, 1c, 2, 4, 11, T |
| 41.5 | Ship rules, every deploy |
| 41.6 | Gate, every step |
| 41.7 | 14 |
| 41.8 | Ship rules, every deploy |
| 41.9 | Before opening up |
| 41.10 | Calls |
| 41.11 | Left out |
| 42.1 | 1a, 1b, 12, 13 |
| 42.2 | Appendix B |
| 42.3 | 1b, 12, 13 |
| 42.4 | 1a, 1b |
| 42.5 | 1b, 12, 13 |
| 42.6 | 12 |
| 42.7 | Appendix E |
| 42.8 | Calls |
| 42.9 | Left out |
| 42.10 | Appendix B |
| 42.11 | Appendix B |
| 42.12 | Appendix B |
| 42.13 | Appendix B, 13 |
| 42.14 | Appendix B |
| 42.15 | Appendix B |
| 42.16 | Appendix B |
| 42.17 | Appendix B |
| 42.18 | Gate, every step; 12; 13 |
| 43 | Review Focus, Step 0 |
| 43.1 | Step 0, Pilot, Before opening up |
| 44.1 | 1d |
| 44.2 | Pilot, Before opening up |
| 44.3 | 13 |
| 44.4 | 0 |
| 44.5 | Tests in each step |
| 44.6 | Gate, every tab step |
| 44.7 | Pilot |
| 44.8 | Plan, every tab step |
| 45.1 | 1b, 1c, 9, 13, 14, Before opening up |
| 45.2 | 9 |
| 45.3 | 13, 14, After the pilot |
| 45.4 | 1b |
| 45.5 | 1c |
| 45.6 | 14 |
| 45.7 | 9 |
| 45.8 | Before opening up |
| 45.9 | Appendix E |
| 45.10 | Calls |
| 45.11 | Left out |

**Top-level sections (their intro text goes with their subsections):**

| Sec | Step |
|---|---|
| 4 | 2 |
| 5 | 3, 6, 12, 13 |
| 7 | 3–13 by tab (rows 7.1–7.13) |
| 10 | 2, 3, T, every step |
| 16 | By tab (rows 16.1–16.13) |
| 18 | 7, 8, 9, 10, 12, 13 |
| 19 | 1b, 9 |
| 20 | Appendix C |
| 21 | T |
| 22 | 9 |
| 23 | 1a, 1b, 13 |
| 24 | 1a, 1b, 8, 11, 13 |
| 25 | 1b, 11, 13 |
| 26 | 1b, 2, 4, 6, 11 |
| 27 | 1a, 1b, 1d, 4, 9 |
| 28 | 1c, 7, 8, 10, 11, 12 |
| 29 | 1a, 1d, 4, 6, 9, 11, 13, Before opening up |
| 30 | 1c, 7, 9, 11, 13, 14 |
| 31 | 1a, 1d, 2, 4, 11, 14, D |
| 32 | 1c, 1d, 4, 11, 13, 14, every tab step |
| 33 | 4, 5, 9, 11, 12, 13, 14, After the pilot, Later |
| 34 | 1b, 3, 13, 14 |
| 35 | 1b, 1c, 1d, 11 |
| 36 | 1a, 1b, 2, 11, 13 |
| 37 | 3, 7, 8, 10, 12, 14 |
| 38 | 1b, 2, 8 |
| 39 | 1c, 1d, 3, T, every tab step |
| 40 | Every tab step |
| 41 | Ship rules; Appendix D; 1a–1d; 14; Before opening up (its "What this corrected" table applies everywhere) |
| 42 | Appendix B (its coverage notes feed 44.8: each tab step reads its shared screens line by line) |
| 44 | 0, 1d, 13, Pilot, Before opening up |
| 45 | 1b, 1c, 9, 13, 14, Before opening up, After the pilot |

## Appendix G — Coverage check (run four times)

A read-only script compares the report with this plan. It extracts:
- every `## N.` and `### N.M` heading in the report, and checks Appendix F has a row for each;
- decisions 1–177 from section 13, checked against Appendix A;
- problems 1–53 and smaller bugs 1–24 from section 42, checked against Appendix B;
- gaps 1–42 from section 11, gaps 1–68 and C1–C6 from section 20, checked against Appendix C;
- the 13 database changes in 41.2, checked against Appendix D;
- every "How this gets built" table (17 tables), checked against Appendix E;
- every item in the 41.3 deploy cells, checked against the 1a–1d step text.

**Results (2 November 2026):**

| Pass | Checked | Found | Fixed |
|---|---|---|---|
| 1 | Report IDs against the appendices (349 headings, 177 decisions, 53 problems, 24 smaller bugs, 42 + 68 gaps, 6 conflicts, 13 DB changes, 20 build tables) | 32 top-level section rows missing | Added the top-level rows to Appendix F |
| 2 | Each problem and smaller bug's step against its own 42.x table, and against the 44.5 test table | No mismatch with 42.x. The report's 44.5 conflicts with 42.7, 42.15 and 41.2 on problems 3, 8, 9 and 44 | Settled in Global Constraints |
| 3 | Every "How this gets built" row against Appendix E; every 41.3 deploy item against the 1a–1d text | 3 rows worded differently; all 41.3 items matched | Wording aligned |
| 4 | Each Appendix F step against that step's body; section 9's places; 41.6 guard tests; 41.4 cases | Sections missing from step bodies; "Top bar search", "Trust and safety", the owner deletion path and the self-review guard test not explicit | All added |
| 5 | Every decision and problem named in each step it belongs to; all checks re-run | 0 missing | — |
