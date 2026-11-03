# Organization live check — problems found

Checked on networkbase.in on 2026-11-03, after commit 773052541 was deployed. Signed in as the owner of
"CSE 3B · Data Structures 2026" and compared each screen with the design report
(`docs/superpowers/specs/2026-11-01-organization-end-to-end-design.md`). Nothing was changed while checking.

The plan ticked these items as done; the live site shows they're not. The step each one reopens is in brackets.

## A. Tasks tab (report 16.1) — the biggest gap

| # | What the report says | What the live site does | Reopens |
|---|---|---|---|
| 1 | One board that holds normal tasks and assignments | Two areas: an "Assignments" box above the board, then the board | Step 13, item 1 (decisions 6, 10, 25) |
| 2 | One button, "New task" | Three: "New assignment", "Review" (both in the box), and "New task" | Step 13, item 1 |
| 3 | One form: choosing many people changes "Create task" to "Create assignment" and shows Hand-in | Choosing "Everyone" closes Create task and opens a separate "New assignment" form | Step 13, item 1 (decision 10) |
| 4 | Filters: All, Sprint, Backlog, In review, Assignments, Mine | Only All tasks, Sprint, Backlog, In review | Step 13 |
| 5 | An assignment card moves by itself; nobody moves it by hand | The assignment card has a "Move to…" menu | Step 1b (decisions 14, 38) |
| 6 | A main assignment's panel has no Status, Section or Assignee | The panel shows all three | Step 1b, problem 34 (decision 147) |
| 7 | Only a student's copy is reviewed | The main assignment shows "Changes requested: Work is not finished", so it went through ordinary review | Step 1b, problem 21 |
| 8 | The board opens at the first column | It opens scrolled sideways: "To do" is cut off; on a phone it opens at "Completed" | New |
| 9 | Overview, Tasks and Files load fast (41.7) | The board appears after about 14 seconds: about 16 server calls run one after another (about 450 ms each) | Step 14 measures |

## B. Sprints (report 16.2)

| # | Problem | Reopens |
|---|---|---|
| 10 | The main assignment "Lab 1" appears twice: in the sprint's Assignments row and again in its task list as "Task-1 · Unassigned" | Step 1a, problem 24 (one visibility rule) |

## C. Overview (report 16.6)

| # | Problem | Reopens |
|---|---|---|
| 11 | "THIS WEEK" heading shows twice, one above the other | Step 4 |
| 12 | Slow: about 3.6 seconds for the owner, about 10 seconds in Preview as member (same cause as #9) | Step 14 |

## D. Updates (report 16.3)

| # | Problem | Reopens |
|---|---|---|
| 13 | While loading it shows the workspace wording, "Progress posts for followers and workspace visitors" and "Share a workspace update…", then switches to the organization wording | Step 1d, smaller bug 20 |

## E. Settings (report 22)

| # | Problem | Reopens |
|---|---|---|
| 14 | Workspace wording on an organization: "WORKSPACE SETTINGS", "Workspace image", "Workspace links" | Step 9 |
| 15 | A locked "Workspace slug" ("Editing is locked for now…") sits right next to a "Handle" you can change. Two controls for one address. | Step 9 (27.8, gap 42) |
| 16 | "All General settings are saved." There's no General section on this menu. | Step 9 |

## F. Search (report 32.2)

| # | Problem | Reopens |
|---|---|---|
| 17 | The box says "Search Workspace / Work and Links…" and offers "Task title / Link name / Link category" on an organization | Step 14 |
| 18 | Results aren't grouped by kind: a document, a file, an assignment and two tasks all sit under "TASKS · 2" | Step 14 |
| 19 | Duplicates: Lab 1 shows as the assignment and again as a task; the syllabus shows as the document and again as its file | Step 14 |

## G. Join page, Discover, team workspace

| # | Problem | Reopens |
|---|---|---|
| 20 | The join page tells the owner "You've been invited to join this organization." | Step 6 (gap 14: every code state) |
| 21 | The organization's Discover card has no type chip, member photos or workspace count | Step D (decision 73, gap 63) |
| 22 | Team Falcon's box is titled "TEAMS" but its button says "Add role" | Step 4 / 11 (gap 32: one name) |

## H. Every page

| # | Problem | Reopens |
|---|---|---|
| 23 | The browser logs React error #418 (server and browser drew different text) on every page, not only the organization. Not yet traced to its text, or to when it started. | New |

## What worked

All 11 organization tabs load with real content. Preview as member, the Calendar dialog, "Last active here",
the Classes section, the teacher guide, the team workspace's "Inside CO1" line and "From CSE 3B" files, and the phone
layout (no page-wide sideways scroll) all work.

## Not checked yet

These need a second, student account, or would change real data:
- a student's own board and Hand in
- review, Return and Extend on a real copy
- Mark away
- notifications and emails
- live updates across two browsers
- creating a calendar link

The class has one member (the owner), and a join request from "Rama" is waiting.

## Deploy time (for the record)

The 3 November deploy took about 18 minutes: the web compile took 15.0 min, against 2.4–3.6 min on earlier deploys.
Locally the new code compiles about twice as slowly as before (88 s → 2.8 min, peak memory under 2 GB), so about
5–6 minutes was expected. The rest was a slow Railway build machine on that run. The worker also compiles the whole site.
