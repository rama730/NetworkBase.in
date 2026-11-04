# Board: one View dropdown with counts — concept, 4 November 2026

Source: the user's screenshot of CSE 3B → Tasks on localhost, and the code. No code changed.

## 0. What was asked

| The user's words | Section |
|---|---|
| "All tasks, Sprint, Backlog, In review, Assignments, Mine… keep simply a drop-down so we get more space, so New task comes in the same row" | §1, §2 |
| "On All Tasks I am unable to see Mine" — nothing tells you what waits in the other views | §3 |
| "Opening that dropdown, the number after the name… Mine… review… assignment… like that for all" | §3, §4 |
| "End-to-end enhancements… tell me" | §5–§7 |
| "The assignment card is very different from the normal task card… redesign it properly" | §6a |

---

## 1. What happens today, and why

- The six views are a row of buttons (`TaskFilters`, the "Show" group). With the running sprint's name
  ("Sprint · CO1 Arrays and linked lists"), the row is ~830px wide, so **New task wraps to a second line** under the
  search, and on narrower laptops Code editor and New column wrap too.
- Only In review has a number, and only inside the review queue. On All tasks nothing says you have 3 of your own
  open, 6 hand-ins waiting, or an assignment due tomorrow — you have to click each view to find out.
- The **Tasks tab's badge** ("Tasks 1") counts one thing per role (admins: hand-ins waiting; members: their work
  due within 2 days, `readOrgTabBadgesAction`), but nothing on the board says which view that "1" lives in.
- **Board 4** counts the cards loaded so far ("4+" while more pages exist); there is no real total.

## 2. Design: one row, one View dropdown

```
 Board 12   [⌕ Filter tasks…      ]  [ All tasks ▾  ● 7 ]  [All teams ▾]  [▭ Code editor ▾]  [+ New column]  [ + New task ]
```

- The six buttons become one **View** button: it shows the view you're on and, at its right, an orange number when
  something in *another* view needs you (§3). Everything — search, View, Team, Code editor, New column, **New task**
  — sits on one line at laptop widths; New task stays last and primary.
- Opening it:

```
 ┌──────────────────────────────────────────────┐
 │ ✓ All tasks                              24  │
 │   Sprint · CO1 · Week 3–4                 9  │
 │   Backlog                                 6  │
 │ ──────────────────────────────────────────── │
 │   In review                         [ 6 ]    │  ← orange: waiting for you (admins)
 │   Assignments                         3      │
 │   Mine                              [ 1 ] 3  │  ← orange 1: due within 2 days; 3 open in all
 └──────────────────────────────────────────────┘
```

- One line per view: name, then its number. **Grey number = how many open** (not done) in that view. **Orange
  number = how many need you now**, the same orange pill as the Tasks tab badge and notifications.
- Picking a view works as today (it's still `?taskScope=`, so links, back/forward and the review queue keep working).
  In review still opens the review queue.
- Keyboard: it's a menu of radio items — ↑/↓ to move, Enter to pick, Esc to close; the current view is checked.
- Phones: the View button is full width on its own row under search (as the button row is today), New task stays
  visible; the menu opens as a sheet from the bottom.
- Normal workspaces get the same dropdown with their four views (All tasks, Sprint, Backlog, In review) and counts.

## 3. The numbers — one rule for every view

| View | Grey: open in this view | Orange: needs you now |
|---|---|---|
| All tasks | open tasks you can see | — |
| Sprint · *running sprint* | open tasks in the running sprint (in an organization: the sprint inside the CO, or the CO when none runs — as the list) | — |
| Backlog | open tasks in no sprint | — |
| In review | **admins / reviewers:** hand-ins and tasks waiting for review · **members:** your hand-ins waiting | admins: all of them (equals the Tasks tab badge) |
| Assignments | **admins:** open assignments (published, not closed) · **members:** your assignments not handed in | members: due within 2 days or missing (equals their Tasks tab badge) |
| Mine | your open tasks and copies | due within 2 days or overdue |

- The **View button's orange number** is the sum of the orange numbers in views other than the one you're on — so on
  All tasks you see "7" and know to open the menu. It disappears when nothing needs you.
- The **Tasks tab badge and the dropdown can't disagree**: both come from the same count (§5).
- **Board N** becomes the real total of the view you're on (from the same count), not "loaded so far".
- With search typed, the numbers stay the view totals (search narrows the cards, not the menu) — "matching …" stays
  next to Board.
- Team filter (team workspaces' units) narrows the cards only, as today.

## 4. Where else the numbers show

- **Sprints page**, Work in this sprint: unchanged (its own counts by stage).
- **Overview**, "Needs you": already lists the same things; its numbers come from the same count so they match.
- **The Tasks tab badge** stays (one number per role) and now matches the dropdown's orange number for that role.

## 5. How it's counted (one read)

- One server read per board, `readBoardCounts(projectId)`, returning `{ all, sprint, backlog, review, assignments,
  mine }`, each `{ open, needsYou }`. One SQL statement with `count(*) FILTER (…)` per view, using **the same
  filters as the list** (`orgTaskReadFilter`, the review and assignments rules, the running-sprint rule), so a
  number can never promise cards the view doesn't show.
- The Tasks tab badge (`readOrgTabBadgesAction`) takes its `tasks` number from the same helper.
- Freshness: re-read when the board's task list changes (create, move, review, return — the same cache keys the
  board already invalidates) and on the live task events the board already listens to; no polling.
- Cost: one indexed count query per board open; the board already runs several reads, this replaces none and adds
  ~one round trip, started with the others on the server (`serverFirst`), so no extra wait.

## 6. Other improvements found on the way (same toolbar)

- **New column** moves into the board's ⋯ menu on desktop too (it's a rare action; today ⋯ exists only on phones).
  Frees ~120px. *(Decision D3.)*
- **Code editor** keeps its place but shows only its icon + "Code" below 1280px so the row never wraps.
- **Empty view text** names the view: "Nothing in Backlog", "Nothing waiting for review", "No assignments due" — with
  the next step (New task / Plan a sprint), instead of the column's generic "Tasks will appear here…".
- **Remember the last view per board** in the URL only (as today) — no hidden preference that surprises people.

## 6a. The assignment card on the board (added after the user's review of the visual design)

**What happens.** The assignment card doesn't look like the task cards around it (`TaskCard`, the `bits` branch):
- capital-letter chips (**ASSIGNMENT**, **1 TO REVIEW**) sit *above* the title, where every task card has its title;
- a one-colour orange bar, with its line **centered** ("0 of 1 done · 1 to review"); the bar stays orange even at
  "All done", so a finished assignment looks like a warning;
- the footer shows the dashed "Unassigned" placeholder, which is wrong: an assignment goes to the class;
- the sprint chip is cut to "C01 Arrays an…" (112px limit); a done assignment's title is struck through.

**Design — the task card's own layout, with only what is different about an assignment** (as shown and agreed):

```
 ┌──────────────────────────────────────────────┐
 │ Lab 2: Linked lists                          │  1. title first, same size and place as a task
 │ ███████▓▓▓▒░░░░░░░░░░░░░░░░░▒▒▒              │  2. stage bar (same colours as Work in this sprint)
 │ 12 of 40 approved · 6 in review · 3 missing  │     one line, left-aligned, mono 11px
 │ [6 to review] [Medium] [CO1 · Week 3–4]      │  3. the task card's chip row; "N to review" first, amber
 │ ──────────────────────────────────────────── │
 │ ▤ Everyone · 40   ▢ 2         [▣ Nov 11] C3D-8│  4. the task card's footer; who it's for replaces the avatar
 └──────────────────────────────────────────────┘
```

1. **Title** first — same element and style as a task's title.
2. **Stage bar** split by stage — Approved (green), In review (orange), Returned (amber), In progress (blue),
   Not started (grey), Missing (red); excused left out — and **one line** under it, left-aligned:
   "12 of 40 approved · 6 in review · 3 missing" (only stages with someone in them; "done" instead of "approved"
   when the assignment needs no review). Groups count groups: "0 of 8 groups approved · 5 working".
3. **Chips** — the task card's row (priority, sprint, points) with one addition in front: **"6 to review"** in amber
   when hand-ins wait (admins and reviewers). Before publishing it's **Draft**, or **Scheduled**; after closing,
   **Closed**. The sprint chip shows the full path ("CO1 · Week 3–4"), up to ~180px, full name on hover.
4. **Footer** — the task card's: on the left, where a task shows its assignee, a clipboard icon and who it's for
   ("Everyone · 40", "Admins · 3", "8 groups", "3 workspaces"), then comment and file counts; on the right the due
   date chip and the code. The clipboard icon is what says "assignment" — no capital-letter chip.

**States.**
- **Draft / scheduled:** dashed border; the line says "Not published · goes to 40 people" or "Publishes Nov 12,
  9:00 am"; no bar.
- **All approved** (Completed column): green full bar, green line "All 39 approved · 1 excused"; the title fades like a
  done task's, not struck through.
- **Nobody has it yet:** no bar; "Nobody has it yet. People get it when they join."
- **A student's own copy** (their board): a normal task card with their photo and "Assignment" by the clipboard icon
  in the footer; the line under the title says where they are, the same words as the sprint list ("Returned: fix the
  README · fix by Nov 13", "In review since Nov 9", "Approved Nov 10"), and a stage chip (Returned in red, In review,
  Approved in green, Missing in red).

**Data.** The board's task list gets the same stage counts and each copy's own stage the sprint list already reads
(`readAssignmentStages` — one read for the page, the roster's `copyState` rule), so the card, the sprint list and the
Assignment tab can't disagree. The existing `assignmentProgress` keeps the card's column (unchanged); scheduled cards
read `publishAt` from the assignment's settings.

**Accessibility.** The bar is an image named by its line; the card's name says "Assignment, Lab 2: Linked lists,
12 of 40 approved, 6 to review, due Nov 11".

## 7. Done when

- At 1440px and 1280px the toolbar is one line with New task on it; at 390px nothing scrolls sideways.
- Each view's grey number equals the cards that view shows (DB test per view and role: admin, member, outsider).
- The orange numbers equal the Tasks tab badge for that role (one test).
- The View button shows the sum of orange numbers from the other views, and it updates after a review, a hand-in and a
  new task without a reload (browser test).
- Keyboard and screen reader: menu of radio items, counts read as "In review, 6 waiting for you".
- §6a: an assignment card has its title first, the stage bar and a left-aligned line, the task card's chips (with
  "N to review" first) and the task card's footer with who it's for — no capital-letter chips, no "Unassigned"; draft,
  scheduled, all-approved, nobody-yet and a student's own copy each look as above (browser test per state, and a
  screenshot next to a task card); the card's numbers equal the sprint list's for the same assignment (DB test).

## 8. Decisions for the user

- **D1 · What the grey number counts.** Open work only (proposal) or everything including done?
- **D2 · The View button's badge.** Sum of "needs you" from the other views (proposal), or just a dot?
- **D3 · New column.** Move into ⋯ on desktop too (proposal), or keep it in the row?
- **D4 · Board N.** Real total of the current view (proposal), or keep "loaded so far"?

**Answered (4 November 2026):** the user accepted the whole concept as written, so D1–D4 take the proposals, and
asked for the assignment card redesign (§6a), shown as a visual design and agreed before it was added here.

## Built and checked (4 November 2026)

Everything above, on local main, not pushed; no migration. D1–D4 as proposed.

- **§2** `TaskFilters` is now the View button: current view, orange sum of "needs you" from the other views, a menu of
  radio items (grey open count, orange needs-you, read aloud as "In review, 6 open, 6 waiting for you"), a divider
  before In review, and on phones (<640px) a sheet from the bottom. The review queue's line uses the same button.
  Search, View, Team, Code editor, ⋯ and **New task** (last, primary) share one line — checked at 1440, 1280 and 1200px.
- **§3, §5** `readBoardCounts` / `readBoardCountsAction`: one statement, the list's own rules (`scopeWhere`, shared by
  the list and the count; `orgTaskReadFilter`; the running sprint). Started on the server with the board's other
  reads (`tasks-boot`), re-read 0.4s after any change to the board's task lists (moves, reviews, hand-ins, live events).
  - *Found while checking:* an organization admin's In review opens the review queue, which includes group hand-ins
    from team workspaces; the count now uses the queue's rule (tested equal to `readReviewQueueAction`'s total).
  - Assignments (admins): the open count includes drafts and scheduled ones, because the view lists them; the
    report's "published, not closed" would have promised fewer cards than the view shows (§7's rule wins).
  - Mine's orange counts your own tasks; your assignment copies count under Assignments, so nothing is counted twice
    in the View button's sum.
- **§4** The Tasks tab badge reads the same numbers (admins: In review; members: Assignments due within 2 days or
  missing — missing is new). The Overview's Needs you rows carry their count and add up to In review; a new
  "N tasks to review · Other tasks" row covers the organization's own tasks waiting, which it didn't show before.
- **Board N** is the view's real total; while searching or narrowed to a team it shows what's on screen.
- **§6** New column moved into ⋯ (shown on desktop only to people who can add columns); Code editor reads "Code"
  below 1280px; an empty view names itself with the next step (Nothing in this sprint → Plan a sprint, Nothing in
  Backlog / Nothing assigned to you → New task, Nothing waiting for review, No open assignments / No assignments due).
- **§6a** the assignment card as designed: title first; stage bar and one left-aligned line; "N to review" / Draft /
  Scheduled / Closed in front of the task card's chips; the full sprint path on its chip (up to 180px); the footer
  says who it's for (clipboard icon: "Everyone · 40", "8 groups", "Admins · 3", "3 workspaces"). Draft and scheduled
  cards have a dashed border; all approved is green with a faded (not struck) title; nobody yet says so; a student's
  own copy shows their stage chip and line. The board reads the same stages as the sprint list (DB test: equal).
  - *Found while checking:* an all-approved card's title was still announced "Completed task: …"; Esc that closed
    the View menu also closed the review queue (a second, unguarded Esc handler) — both fixed, with tests.

Not checked here: your signed-in screens. The DB test "a mention tells…" still fails on this machine for the network
reason noted before (unrelated).
