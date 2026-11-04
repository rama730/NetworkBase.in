# Sprint tab and New sprint redesign, and the orange focus ring — findings, 4 November 2026

Sources: the user's screenshot of CSE 3B › Sprints (localhost), the live Create sprint dialog in Chrome (opened and
closed, nothing saved), and the code: `src/components/workspaces/tabs/SprintPlanning.tsx`, `tabs/sprint/*`
(SprintLeftRail, SprintHeader, SprintTimelineContent, SprintLifecycleModals, SprintCalendar),
`src/components/organizations/OrgSprintParts.tsx` and `src/components/workspaces/v2/sprints/CreateSprintModal.tsx`
(780 lines). No code changed.

## 0. The orange outer ring

| # | Finding |
|---|---|
| 0.1 | The ring is the app-wide keyboard focus outline (`:focus-visible { outline: 2px solid var(--focus-ring) !important; outline-offset: 2px }`, globals.css, decision 75). It draws around any focused control: tabs, buttons, inputs, rows. |
| 0.2 | It also appears after mouse use: after a click that navigates (the Sprints tab in the screenshot), after a dialog closes and gives focus back, and on fields focused by code. Chrome treats those as keyboard-style focus. |
| 0.3 | Each focused control already gets a second sign: a 14% clay tint on links and plain controls, and a clay border plus a light overlay on shared Buttons (globals.css, "App-wide keyboard focus"). |
| 0.4 | Some components add their own ring (`focus-visible:ring-1 ring-primary`, for example the phone sprint select and the sprint form's inputs); the global rule zeroes those shadows but they are noise in the code. |

**Proposal:** remove the outline everywhere (the global rule and the per-component `focus-visible:ring-*`). Keep keyboard
focus visible without a ring, as WCAG 2.4.7 needs: the existing clay tint on links, tabs and rows; the clay border on
Buttons; and for inputs, selects and textareas a darker border (as the sign-in fields already do). Tabs also get their
underline. Net: no orange box anywhere, and keyboard users still see where they are.

## 1. What a sprint is today, and why it reads as complex

A sprint here is a stretch of dates with a name, an optional goal and description, a status, materials, and work
(tasks and assignments) that carries the sprint's id. In an organization it also has: whether it starts by itself,
which workspaces it is shared with, whether teams plan their own sprint inside it, an announcement, and a list of
team workspaces with their own sprints. A team workspace's sprint can sit inside an organization sprint.

None of that is explained on the page. The page shows a list of sprints and one sprint's details; the form shows
every option at once.

## 2. The sprint page

| # | Finding |
|---|---|
| 2.1 | No picture of the term. The left rail lists sprints by status (Active, Upcoming, Completed, Canceled, Archived) as cards with dates; gaps and overlaps between sprints aren't visible. The Calendar button is separate, top right, alone in its own row. |
| 2.2 | The header's main button is **Complete sprint** in clay, even with 11 days left. The action that matters while a sprint runs (putting work in it) isn't on the page at all. |
| 2.3 | Work can't be added from the sprint. The empty state says "Add tasks from the Tasks tab"; assignments land in a sprint only by being created inside it. |
| 2.4 | The summary strip (`50% done · 1/2 tasks · 2 files · Started Nov 1, 2026`) is small mono text with a 96px bar. Time passed and work done are never compared, so "are we on track?" has no answer. |
| 2.5 | The work list is one flat list. Removed items sit among live ones ("TO DO Lab 1 … REMOVED · Nobody has joined yet"), and the same title can appear twice (a removed main assignment and a completed one). Nothing groups by state. |
| 2.6 | "Workspaces · 0 of 1 linked" with "Not planned · Remind" is unclear wording: linked to what, planned what. |
| 2.7 | Materials is an empty labelled row with "Add material" and no line saying what materials are for. |
| 2.8 | The code (SPR-1) sits beside the main button as if it were an action. Status words differ by place: "IN PROGRESS" chip, "Active" group, "running" in the form, "planning" in the database. |
| 2.9 | An ended sprint that wasn't completed looks the same as a running one; nothing asks the admin to close it or says what happens to open work until the Complete dialog. |
| 2.10 | Phones get a select and a "New" button; the rail, the work list and the side blocks were not designed for a phone. |
| 2.11 | Edit and Delete: Delete lives at the bottom of the Edit form (Planning only); Cancel and Archive live in the ⋯ menu. Three places for the end of a sprint's life. |

## 3. New sprint (the create form)

| # | Finding |
|---|---|
| 3.1 | One long scrolling dialog: Basics (name, goal, description), Schedule (quick dates, start, end, duration line, "Plan more sprints like this", "Move later sprints too"), Organization (start automatically, share All/Selected/None, teams plan their own, announcement, move due dates). In an organization it holds up to 12 controls. At a laptop height, everything after the dates is below the fold. |
| 3.2 | **Planning several sprints is a checkbox in the middle of Schedule.** The empty state even tells the admin to "Turn on 'Plan more sprints like this'". Planning the term, the main job at the start of a course, is hidden behind a toggle, and turns the form into a different form. |
| 3.3 | Goal and Description are two fields for nearly the same thing; the goal is optional. |
| 3.4 | Quick dates are tiny mono buttons in the section heading ("QUICK DATES: 1 WEEK 2 WEEKS 4 WEEKS"). |
| 3.5 | The form doesn't show where the new sprint falls among the others. Overlap is checked only in the several-sprints preview. |
| 3.6 | The organization options are in words the admin has to decode: "Share with workspaces: All / Selected / None", "Teams plan their own sprint inside it", "Start automatically on the start date". Their defaults are fine, but the admin can't see them without scrolling. |
| 3.7 | The team workspace version is a different form again: an "Inside" select at the bottom, "Plan one for each of …'s N planned sprints", "Also add N group assignments". The most important choice for a team (which class sprint) comes last. |
| 3.8 | The footer buttons are mono uppercase ("CANCEL", "CREATE SPRINT"), unlike every other dialog. |

## 4. Redefinition

**A sprint is a fixed stretch of time with one goal.** Work is planned into it, it runs, and when it ends it's closed:
what's done is counted, what isn't moves on.

- **Life:** Upcoming → Running → Ended (needs closing) → Closed. Canceled and Archived fold into "Past". One word per
  state everywhere (chip, rail, form).
- **In an organization:** the class sprint is the shared time box (a unit, a module). Teams plan their own sprint
  inside it. Assignments due in it belong to it.
- **One main action per state:** Upcoming → Add work (Start now beside it); Running → Add work (Complete early
  beside it); Ended → Close sprint.

## 5. The new page (keep the layout: rail left, sprint right)

1. **Rail = the term.** Groups Now / Next / Later / Past. Each item shows dates and, when running, "day 4 of 15" with a
   time bar. Gaps between sprints show as "Gap · Dec 15–20 · No sprint planned". **New sprint** stays at the top.
   The Calendar moves into the rail header.
2. **Header:** status chip with the dates and days left on one line, the name, then the goal as a sentence. Edit and ⋯
   on the right (⋯ holds Complete early, Cancel, Archive, Delete when empty). The code moves to the ⋯ menu / URL.
3. **Two numbers side by side:** Time passed and Work done, each with a bar, and "ahead / on track / behind".
4. **Work in this sprint**, grouped In progress / To do / Done, with **Add work** (a picker over the backlog: tasks
   and assignments not in a sprint, with search). Assignments show class progress ("12 of 40 handed in"). Removed
   work folds into "Taken out of this sprint · N".
5. **Teams** (organization) in plain words: "0 of 1 planned · Team Falcon · no sprint yet · Remind", each team's
   sprint with its progress when it has one. **Materials** with one line saying what they are for.
6. **Ended** shows an amber banner: "Ended Nov 15 · 2 of 3 done · 1 still open · Close sprint", and Close asks where
   open work goes (next sprint or backlog).
7. **Phone:** the rail becomes a horizontal strip of term chips above the sprint; Time / Work stack; Add work stays
   at the bottom.

## 6. The new New sprint

1. **First choice at the top:** One sprint · Several (plan the term). Several is a mode of its own, not a checkbox.
2. **One sprint:** Name; Goal (one sentence; "Add notes" folds the old description); Dates as chips
   1 week · 2 weeks · 4 weeks · Custom, with start defaulting to the day after the last sprint, and a **term strip**
   under the dates showing the neighbours and the new sprint, with "Starts right after CO1. No overlap." or the clash.
3. **Several:** Names start with, How many, First starts, Each lasts, then "You'll get" listing each sprint with its
   dates (and "passes the term end" / overlaps marked). Goals are written later, per sprint.
4. **For the class** (organization): one line of plain sentences showing the current choices ("Starts by itself on
   Nov 16 · Teams plan their own sprint inside it · Shared with all 1 workspace · No announcement") with **Change**,
   which opens the options in place. Nothing important sits below the fold.
5. **Team workspace:** the class sprint comes first ("Inside the class sprint: CO2 · Nov 16–30"), dates start as its
   dates and can only shrink, then name and goal, then "Bring the 2 group assignments due in CO2".
6. Sticky footer in normal sentence case: Cancel · **Create CO2** / **Create 4 sprints**.
7. **Edit** uses the same form without the One/Several choice; a running sprint's start date is locked with a line
   saying why; "Move later sprints too" and "Move due dates too" appear only when the dates change.

## 7. Risks and decisions for you

- **Focus ring:** removing it is a deliberate change to decision 75. The plan keeps keyboard focus visible with
  tints and borders; if you want no focus sign at all for keyboard users, that fails WCAG 2.4.7, so the plan doesn't do that.
- **Add work picker:** needs a server read of unsprinted tasks and assignments for the sprint's workspace, and a
  bulk "move into sprint" action (both new, no migration expected).
- **Status words:** "Running / Upcoming / Ended / Closed" replace "Active / IN PROGRESS / Planning" on screen; the
  database values stay.
- **Term strip and gaps** use the existing sprint dates only; "term end" uses the organization's existing setting.

## 8. The same pattern for a normal workspace (approved direction, added 4 November 2026)

A normal workspace (not in an organization) uses the same `SprintPlanning` page and `CreateSprintModal`, without the
organization parts. What it has: tasks with assignees, story points and the board's own columns (up to six), the
backlog (tasks with no sprint), sprint files, and Complete with "keep / backlog / a planning sprint" for unfinished
work. Today it shares every problem in §2 and §3 except the organization ones, and it shows tasks only as a count
("1/2 tasks"), never points or who carries what.

| # | Finding |
|---|---|
| 8.1 | Points exist on tasks but the sprint never adds them up; "done" is counted in tasks, so one 13-point task weighs the same as a 1-point one. |
| 8.2 | No view of who has what in the sprint; an overloaded person or unassigned work isn't visible. |
| 8.3 | The backlog isn't reachable from the sprint page; planning means switching to Tasks and setting each task's sprint one at a time. |
| 8.4 | No sense of how much fits: nothing shows what earlier sprints finished. |
| 8.5 | The work list ignores the board's columns (the workspace's own To do / In progress / Blocked / Done…). |
| 8.6 | Closing offers three radio cards with long technical descriptions ("retaining unfinished tasks for reporting"). |

**Design (same layout, same rules as §4–§6):**

1. **Rail:** Now / Next / Later / Past with gaps, as for organizations, plus a **Backlog** entry at the bottom
   ("14 tasks not in a sprint"). Past sprints show what they finished ("Closed · 21 points done").
2. **Header:** status chip, dates and working days left, name, goal sentence; Edit and ⋯.
3. **Time and Points done** side by side ("5 of 26 points · on track"). Without points on any task, it falls back to
   tasks done.
4. **Work** grouped by the board's own columns (Blocked shown in red with its reason), or by person; each row shows
   points and the assignee. **Add work** opens the planning picker. Removed work folds away.
5. **People:** each member's open points in this sprint, "heavy" when well above the others, and "Nobody yet" for
   unassigned tasks. **Files:** sprint files with one line on what they are for.
6. **Add work (planning picker):** backlog on the left with search and tick boxes; on the right the sprint's points
   total against "last sprint finished 21 · recent average 23", warning when the plan is more than usual, and
   "1 task has no points". The button names the count ("Add 2 tasks").
7. **Close sprint:** "Ended Nov 14 · 21 of 26 points done · 5 tasks finished", then "2 tasks still open go to":
   the next sprint (named, with its start) · the backlog · stay here, for the record. Default: the next sprint
   when one is planned, otherwise the backlog.
8. **New sprint:** the same short form as §6 without "For the class": One / Several, Name (next number suggested),
   Goal, length chips, the term strip, and "Starts by itself on Dec 1 · Change". Footer "Create Sprint 6".
9. **Members who can't manage sprints** see the same page without New sprint, Edit, Add work and Close, and a
   "Mine" filter on the work list.

**Shared build:** both versions are one page and one form; the organization adds "For the class", Teams and
assignments, the workspace adds Points, People and the planning picker. A team workspace inside an organization gets
both: the class sprint it sits inside (§6.5) and Points / People / planning.

**New server pieces (no migration expected):** sprint points totals (done and planned) in the sprint summary;
per-person open points; finished points of the last closed sprints; a backlog read with search; a bulk "move tasks
into sprint" action. The organization's "Add work" uses the same picker over unsprinted tasks and assignments.
