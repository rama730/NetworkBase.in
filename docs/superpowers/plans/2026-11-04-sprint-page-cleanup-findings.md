# Sprint page cleanup — findings, 4 November 2026

Sources: the user's three screenshots of CSE 3B → Sprints on localhost (CO1 page, New sprint, Work in this sprint),
and the code. No code changed.

## 0. What was asked, and where it's answered

| The user's words | Section |
|---|---|
| "Two buttons: new sprint and add a sprint inside… use only one sprint button" | §1 |
| "On the top it's showing main sprint and sprint inside a CO, and on the bottom one sprint / several… check that root cause" | §2 |
| "Calendar… keep it to the right side of Add work so we get the header neatly" | §3 |
| "Work in this sprint… opening the dropdown of an assignment… how many are done, in review, accepted, in progress… for every stage" | §4 |

---

## 1. Two buttons open the same form

**What happens.** The rail has **New sprint**; a CO's header has **Add a sprint inside CO1 Arrays and linked lists**
(the main, orange button). Both open the same New sprint form; the second only pre-picks "Sprint inside a CO" and CO1.
Two orange buttons on one screen, and the long one pushes Add work, Edit and ⋯ to the edge.

**Why.** Report §6 added "Add a sprint inside" as the CO page's main button (`SprintHeader`, `onAddInside`) while the
rail's New sprint stayed. The empty strip also says "Split it into weeks with *Add a sprint inside*".

**Design.**
- **One button: New sprint** (in the rail, as today). Remove "Add a sprint inside" from the header.
- New sprint opens on the right tab for where you are (decision D1):
  - no CO yet → **CO** (the only choice; "Sprint inside a CO" waits until one exists);
  - otherwise → **Sprint inside a CO**, with the CO you're looking at picked (or the running one), and its start the
    day after its last sprint — exactly what "Add a sprint inside" did. One click on **CO** switches.
- The CO page's header gets Add work back as its main button (§3).
- The empty strip reads: "No sprints inside CO1 yet. Split it into weeks with **New sprint**."

## 2. New sprint: two rows of tabs

**What happens** (second screenshot). Under the title: an empty band, then **CO (main sprint) · Sprint inside a CO**
on a beige band, then **One sprint · Several (plan the term)** on a second beige band, then Name. Two tab rows of the
same weight look like two menus; it isn't clear which choice comes first or that they combine.

**Why.**
1. Two separate choices were each given a full tab row: *which level* (report §6) was stacked on top of *one or
   several* (sprint redesign §6.1), each its own `UnderlineTabs`.
2. `UnderlineTabs` paints `bg-background` (the page colour). Inside a dialog (card colour) that shows as a beige band
   behind each row — it's right on the profile page, wrong in a dialog.
3. "Several (plan the term)" under **CO** means several COs, under **Sprint inside** "Several (split CO1)" — the label
   changes with the row above, which is easy to miss.

**Design.**
- **One tab row only, the level:** `CO` · `Sprint inside a CO`. No band (the tabs take the dialog's own surface).
- **One or several moves to Dates**, where it belongs (it's about dates): under Dates a small choice
  `One · Several`; picking Several turns the date fields into "How many · How long each · Starting" with the
  preview list, as Several does today. Wording follows the tab: "Plan 3 COs" or "Split CO1 into 3 sprints".
- Sprint inside a CO: the **Inside** picker comes first, then Name, Goal, Dates.
- Normal workspaces (no levels): no tab row at all; One · Several sits under Dates the same way.

Mock-up (organization, Sprint inside a CO):

```
 New sprint                                                        ×
 A stretch of time with one goal. Work goes into it; when it ends, you close it.
 ───────────────────────────────────────────────────────────────────
  CO        Sprint inside a CO
            ━━━━━━━━━━━━━━━━━━
 Inside the CO   [ CO1 Arrays and linked lists · Nov 1–15 (running) ▾ ]
 Name *          [ Week 3                                          ]
 Goal            [ One sentence everyone will read                  ]
 + Add notes

 Dates           ( One )  Several
                 1 week   2 weeks   4 weeks
 Starts * [ 08/11/2026 ]          Ends * [ 15/11/2026 ]  ← capped at CO1's end
 Starts right after Week 2. No overlap.
 ───────────────────────────────────────────────────────────────────
                                           Cancel   [ Create Week 3 ]
```

## 3. The header: one line of buttons, Calendar beside Add work

**What happens.** The rail's top row is "TERM · Calendar"; the header's buttons are "Add a sprint inside CO1…",
Add work, Edit, ⋯ — the long orange one wraps the line on narrower screens.

**Why.** Calendar was placed in the rail (it shows the whole term); §1's button made the header crowded.

**Design.**
- Header buttons, left to right: **Add work** (main) · **Calendar** · **Edit** · ⋯ — all 34px, one line.
- Rail top row: just **TERM** and New sprint under it.
- Calendar shows for the same people as today (members and owners). On phones the header buttons wrap under the title
  as now, Calendar included.

## 4. Work in this sprint: an assignment's row says where everyone is

**What happens** (third screenshot). The ALM-1 row reads "C3D-8 · 0/1 · Due Nov 11" — "0/1" with no word. Opening it
shows "No description provided." and "View full task details". Nothing says who handed in, who's waiting for review,
who was approved or who hasn't started.

**Why.** The sprint's work list (`SprintTimelineContent`) is built for tasks: the open part shows description,
subtasks and files. For a main assignment the server only sends `assignmentProgress {done, total}`
(`readMasterProgress`), so the row prints "0/1" in the person slot. The Assignment tab already counts every stage per
copy (`copyState`: not started, in progress, in review, returned, done, missing, excused) — the sprint list doesn't
use it.

**Design — one set of stages everywhere** (the Assignment tab's own, `ASSIGNMENT_STATE_LABELS`):

| Stage | Means | Colour |
|---|---|---|
| Not started | has it, hasn't opened it | grey |
| In progress | working on it | blue |
| In review | handed in, waiting for a reviewer | orange |
| Returned | sent back to fix | amber |
| Approved (or **Done** when the assignment needs no review, D2) | accepted | green |
| Missing | past due, not handed in | red |
| Excused | left out, doesn't count | grey, struck |

**Closed row:** `ALM-1 · C3D-8 · 1 of 40 done · 12 in review · 3 missing · Due Nov 11`, and a thin bar split by
stage. Only stages with someone in them are named; "Nobody has it yet" when it has no copies.

**Open row** (admins and reviewers):

```
 ▾ IN PROGRESS  ALM-1                                  C3D-8 · Due Nov 11
   ██████████▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▒▒▒
   Approved 10 · In review 6 · Returned 2 · In progress 14 · Not started 5 · Missing 3   (Excused 1)

   In review 6      Asha, Kiran, Team A, Priya, +2          [ Review 6 ]
   Returned 2       Ravi, Meena                             (fixing — due Nov 13)
   Missing 3        Arjun, Sita, Leo                        [ Remind 3 ]
   Not started 5    …                                       [ Remind 5 ]

   Instructions: Implement a dynamic array… (two lines, More)
   [ Open the roster ]   [ Open the assignment ]
```

- Each stage line opens the Assignment tab's roster on that stage; **Review N** opens the review queue on this
  assignment; **Remind** uses the roster's existing remind.
- Group work counts teams, not people ("Team A"), as the roster does.
- **A student's row** (their own copy) shows their stage instead: "In review since Nov 9 · version 2", "Returned:
  fix the README · due Nov 13", "Approved Nov 10", with their hand-in and **Open**.
- **Plain tasks** keep today's open part but drop "No description provided."; an empty one shows the assignee, the
  due date and Open.
- Counting is the roster's (`copyState`), read once for all assignments on the page — the sprint list and the
  Assignment tab can never disagree. Late copies keep their "Late" mark inside the stage.

## 5. Order of work

1. §1 and §3 together (header and buttons).
2. §2 the form.
3. §4 assignment stages (server counts by stage, closed row, open row, student row).

## 6. Decisions for the user

- **D1 · Where New sprint opens.** Once a CO exists: on **Sprint inside a CO** with the current CO picked
  (proposal), or always on **CO**?
- **D2 · "Accepted".** For assignments that need review, call the last stage **Approved** (proposal) and keep
  **Done** for ones without review — or use one word for both?
- **D3 · Several.** Move One · Several under Dates (proposal), or keep it as tabs but only one row of tabs?
- **D4 · Names in the open row.** Show up to five names per stage with "+N" (proposal), or counts only and the
  names in the roster?

## Built and checked (4 November 2026)

Decisions taken as proposed (D1–D4). Built on local main, not pushed; no migration.

- **§1** "Add a sprint inside" is gone; every New sprint opens inside the CO you're looking at (or the running one,
  or the first planned one), on "Sprint inside a CO". With no CO yet there is no tab row, only a line saying to start
  with a CO. Add work is the CO header's main button again; the empty strip says "with New sprint".
  *Found while checking:* the form could mount already open and skip its opening reset, so it opened on CO; the level
  now comes from one rule used at mount and on every opening.
- **§2** one tab row (`CO · Sprint inside a CO`); the shared tabs no longer paint the page colour, so no band in any
  dialog (New task included). One · Several is a small choice beside Dates; Several reads "Plan 4 COs." or
  "Split CO1 into 3 sprints.".
- **§3** header: Add work · Calendar · Edit · ⋯; the rail's top row is just TERM. Calendar now also shows on phones
  (the rail is hidden there). With no sprint picked there's no header, so no Calendar.
- **§4** the server reads every stage per assignment once per page (`readAssignmentStages`, the roster's
  `copyState`), with up to five names per stage and the copies to remind.
  - Closed row: "10 of 40 approved · 6 in review · 2 returned · 3 missing" and a stage bar (hidden while open).
  - Open row: counts by stage; each stage line with names (+N); its name opens the assignment's roster filtered to
    that stage (`rosterTile`: Done, In review, Not handed in, Excused — the roster's own tiles); Review 6 opens the
    queue on this assignment; Remind N reminds exactly the Not started / Missing copies; instructions in two lines
    with More; "Open the assignment" (its panel opens on the roster, so one link covers "roster" and "assignment").
  - A person's own copy: their stage on its own line under the row ("Returned: Fix the README · fix by Nov 6") and,
    open, what they handed in.
  - Plain tasks: no "No description provided."; an empty one shows who has it, the due date and **Open**.
  - Phones: names drop under their stage, the summary wraps, nothing scrolls sideways (checked at 390px).

Not checked here: your signed-in screens; the DB test "a mention tells…" still fails on this machine for the network
reason noted before (unrelated).
