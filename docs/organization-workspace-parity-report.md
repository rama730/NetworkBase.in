# Organization and Workspace Parity Report

**Date:** 1 November 2026
**Status:** Audit agreed with the owner. No fixes from this report have been built yet.
**Build rule:** Work starts only when the owner says "implement". Nothing deploys until the owner says so.

## 1. The direction

An organization should look and work like a normal workspace, with a few extra powers. It should not feel like a second product.

- Each shared tab is the same screen on both. Organization features are built into that screen, not stacked on top of it.
- Small details match too, such as the icons in Activity.
- Everything stays simple. Sections should follow the application's design, not read as plain lines of text.
- The bugs found during this audit are accepted and will be fixed as part of this work.

## 2. How the audit was done

- Every tab was compared live on production, signed in as the owner: **CSE 3B · Data Structures 2026** (organization) against **DeepScope AI** (workspace), at 1280px wide.
- The code behind each tab was read.
- To see the organization with work in it, real content was created through the app. Section 8 lists it.

Limits of the audit:

- The owner is CSE 3B's only member, so the Members tab, rosters and assignment progress could not be seen with real volume.
- No files could be uploaded from the test browser.
- Member and visitor views were not fully audited. Most checks were as owner. The About page was also seen signed out before the content was added.

## 3. All tabs at a glance

| Tab | Workspace | Organization | Result |
|---|---|---|---|
| Overview | Yes | Yes | Different screen; plain sections |
| About | No | Yes | Organization only, stays |
| Documents | Yes | Yes | Shared screen, small gaps |
| Updates | Yes | Yes | Shared screen, extra box and wrong wording |
| Sprints | Yes | Yes | Shared screen, extra buttons and blocks |
| Tasks | Yes | Yes | Two systems on one page |
| Files | Yes | Yes | Extra boxes above the file browser |
| Workspaces | No | Yes | Organization only, stays |
| Members | Settings only | Yes | Organization only, stays |
| Settings | Yes | Yes | Different starting page, order and items |

## 4. Tab by tab

### 4.1 Overview

| Today | Change |
|---|---|
| Activity has no icons. On a workspace, each row has an icon with the time underneath (`RecentActivityCard.tsx`). | Use one shared activity design and one icon set on Overview and About, on both organizations and workspaces. |
| "Get started" is plain text with `○` characters, and nothing can be clicked. | Real rows with an icon, a link and a done state. |
| Needs your attention, This sprint, Coming up, Workspaces and People are plain lines of text. | One row style with icons, status chips, and progress where it applies. |
| People shows "Ramanayudu, 1 joined this week". | Photos and a count, matching the header. |

The times and "Nothing due" problems are in section 5.

Open question for the build: a workspace's Overview shows its description, and an organization's shows a dashboard, with the description in About. That split stays for now, because it matches the "more options, like overview and about" direction. The sections just need to look right.

### 4.2 Tasks (the largest change)

Today an organization has two systems on one page:

- An **Assignments** box with its own form (`AssignmentsPanel.tsx`, 577 lines, placed above the board at `WorkspaceDashboardClient.tsx:1194`).
- A **Board** with a different form (`CreateTaskModal.tsx`).
- They duplicate each other: `Lab 1` shows in the box and also as an "Unassigned" card on the board.
- The "Marking work as completed…" line sits awkwardly between them.

The change:

- **One button and one form.** "New task" uses the workspace's form, with an "Assign to" field: one person, everyone, a team, or each workspace.
- **Extra options only when needed.** Submission type and late rules appear only when a task goes to many people or needs something handed in.
- **One board.** Assignments become normal cards with a badge such as `12/40 done`. Opening one shows the roster in the same task panel.
- **"Needs review" and "Review"** move into the board's filters, and the separate box goes away.

What stays the same: members still see only their own copy.

Why this is practical: assignments and tasks are already stored in the same `tasks` table, using `kind = 'assignment'` for the main record and `assignment_id` for each copy (`src/lib/organizations/assignments.ts`). This is mostly merging screens, not changing how data is stored. The existing server actions and tests still need checking when this step is planned.

### 4.3 Sprints

- "Plan a series" and "New sprint" are separate buttons. There would be one "New sprint" form with a "Repeat" option for a series (`PlanSeriesButton` in `OrgSprintParts.tsx`).
- The sprint page adds "Linked workspaces" and "Assignments" blocks a workspace doesn't have. "Assignments" repeats the task list below it, so it goes away. "Linked workspaces" folds into the sprint's details.
- A sprint in Planning shows "Started Nov 1" at the same time as "Starts automatically".

### 4.4 Files

- "Folder access" and the storage line sit above the browser, pushing it down, with a row of dropdowns for every folder (`OrgFilesPanel.tsx`, `WorkspaceDashboardClient.tsx:1204`).
- The page should look exactly like a workspace's Files tab:
  - Access moves to each folder's `⋯` menu, with a small "Admins" chip on the folder.
  - Storage moves to the bottom of the left panel.
  - "Sprint materials" and "Final files from workspaces" become items in the left panel.
- The left panel says "Org files" where a workspace says "All files" (`FilesTabRoot.tsx:797`). Use one name.
- The storage line sits right against the left edge.

### 4.5 Documents

The screen is already shared, so it is mostly right.

- "Add document" took about 8 seconds, then opened the Files tab instead of the new document in Documents.
- The empty state reads differently from a workspace's.
- Organization group and admin tools (`OrgDocParts.tsx`) should sit in the same right-hand panel a workspace uses.

### 4.6 Updates

- The page says "Progress posts for followers and workspace visitors" (`UpdatesTab.tsx:448`) and "Share a workspace update" (`WorkspaceUpdateComposer.tsx:915`, `:939`). Both are wrong on an organization.
- A large options box (Announcement, Discussion, Also email, Pin…) sits above the composer. It moves inside the composer and shows only after you start writing.

### 4.7 Settings

- An organization opens on "My membership". A workspace opens on its details.
- The menu has a different order and more items. It should use the workspace's order, with organization-only items added in place.
- The menu is labeled "Workspace settings" on an organization (`WorkspaceSettingsNavigation.tsx:104`).

### 4.8 About, Workspaces and Members (organization only)

These stay, but use the same rows and cards as everything else.

- **About:** Recent activity needs icons.
- **Workspaces:** the "Updated by" line cuts off in the row, and it shows many filter dropdowns by default. Show fewer.
- **Members:** the wording bugs in section 5.

## 5. Bug list

### Clearly wrong

| # | Problem | Cause | Where |
|---|---|---|---|
| 1 | The sidebar's plus button says "You're not a member of 37af553e-…" and falls back to Personal, even for the owner. | The link sends the organization's ID, and the page reports it as not a membership. The "+ New" menu sends the slug instead. | `SidebarWorkspaces.tsx:51`, `workspaces/new/page.tsx:46` |
| 2 | "Select Create workspaceect in the footer" on the review step. | Text bug. | `Phase5Review.tsx:450` |
| 3 | `CO1 started` says 16 hours ago, though it was started minutes earlier. | It uses the sprint's scheduled start date, not when it actually started. | `org-dashboard.ts:69` |
| 4 | "1 person joined this week" always says about a second ago, which also breaks the list order. | Its time is set to the moment the page loads. | `org-dashboard.ts:76` |
| 5 | The live site logged 14 React errors (#418) while signed in: server and browser rendered different text. | **Not found yet.** It may also explain a left-shifted page seen once, but that is a guess. | To investigate |
| 6 | "Workspace or workspace" appears as a heading. | Leftover from a text replacement. | `GeneralSettingsSection.tsx:761`, `ContributionEditor.tsx:1262`, `:1284` |

### Behavior

| # | Problem | Cause or detail | Where |
|---|---|---|---|
| 7 | "Coming up, next 7 days" says "Nothing due" while `Lab 1` is due 8 Nov. | The check counts exactly 168 hours from now, and Lab 1 was due about two hours past that. It should count calendar days. | `org-dashboard.ts:155`–`156` |
| 8 | "Add document" is slow and lands on Files. | See 4.5. | Documents tab |
| 9 | The task board opens scrolled sideways, hiding the To do column at 1280px. | **Happens on workspaces too**, so it is a shared bug. Cause not traced yet. | Tasks tab |
| 10 | The sidebar flashes "No workspaces yet", and a differently ordered list, before real data loads. | Seen on reloads. | Sidebar |
| 11 | Some tabs still showed loading placeholders after 6 seconds. | The test browser pane may have slowed them. **Measure properly before treating this as a bug.** | Tasks, Documents, Updates |
| 12 | A long "Join…" heading overflows the About right column by 21px at 1024px wide, making the page sideways-scrollable. | The heading can't wrap, so it should cut off with "…". | `RailSectionHeading` in `rail-section.tsx` |

### Wording

| # | Problem | Where |
|---|---|---|
| 13 | `1 projects` should be `1 workspace`. | `OrgOverviewParts.tsx:166` |
| 14 | `1 members` and `1 owners and admins`. | `OrgMembersTab.tsx:173`–`174` |
| 15 | "1 project not linked". | `OrgSprintParts.tsx:73` |
| 16 | "This is how your workspace card will appear in Discover" shows even for an organization-only workspace. | `Phase5Review.tsx:464` |
| 17 | "Lab 1" shows "0 of 0 done" when the organization has no members besides the owner. It should explain why. | Tasks tab |

## 6. Build order

Each step is delivered and reviewed on its own.

1. **Bugs and wording.** Section 5.
2. **Overview and About.** Shared rows and icons.
3. **Files, Documents, Updates and Settings.** Match the workspace layout.
4. **Sprints.** One form.
5. **Tasks.** One form and one board. This is the biggest change, so it goes last and gets its own plan.

## 7. Work already done in this effort

| Change | Commit | Status |
|---|---|---|
| Presence removed; "Updated by" added; migration 0041 | `e9334287d` | Live |
| Sidebar row: plus, number, drop-down with no overlap | `8632bedcf` | Live |
| One header for workspaces and organizations | `26aa5fc6a` | Live |
| No empty space under the header image; people row under the image | `5464d41ad` | **Local only, waiting for the owner's go-ahead** |

Follow-ups from that work:

- Drop the old `workspaces.status_*` columns in a later release. None held a value when presence was removed.
- The browser test suite still has 14 failures and 119 tests that never run. They are not caused by this work, and a separate task was proposed for them.

## 8. Content created in CSE 3B for this audit

All of it was created on production through the app, as the owner. No accounts were made, nobody was invited, and no emails were sent on purpose.

| Item | Visibility |
|---|---|
| Welcome announcement | Members only |
| Sprint `CO1 Arrays and linked lists`, running to 15 Nov | Not checked for visitors |
| Assignment `Lab 1: Arrays and linked lists`, due 8 Nov | Not checked for visitors |
| Task `Prepare the Lab 1 grading rubric` | Not checked for visitors |
| Workspace `Team Falcon: Hash table library` | Organization only |
| Document `Course syllabus`, empty | **May be visible to visitors**, not checked signed out |

The join request from "Rama" was left for the owner to decide.

## 9. Still to verify

- The owner's camera button in the header, and "Your role" in the About tab's Details box.
- The "Part of" line on a workspace inside an organization, now that Team Falcon exists.
- Whether the empty syllabus is visible to signed-out visitors.
- How the organization tabs look with many members. This needs real people to join.
