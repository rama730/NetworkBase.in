# Files → Submissions and Sprint materials like Task files; the review queue as one card — findings, 4 November 2026

Sources: the user's screenshot of CSE 3B → Files → Submissions, their notes on Tasks → In review, and the code. No code
changed.

## 0. What was asked

| The user's words | Section |
|---|---|
| "The submission button on the Files tab should be the same as the Task files… Sprint materials the same way" | §1, §2 |
| "In review… instead of the card type, a normal type… the orange bar should not be there… like the main navigation when selected" | §3 |
| "A single card which divides these three, so we use all the space" | §3 |

---

## 1. Files → Submissions, the Task files way

**What happens.** Task files (`TaskFilesCollection`) is a file browser: a filter bar with live counts (Status: All ·
To do · In progress · Completed · In review) and a search, sortable columns (Name · Last updated · Size · By), each
task a folder row with its status, and opening one shows its files in the shared file list (`FolderListView`) with
open, download and the viewer. Submissions (`SubmissionsView` in `OrgFilesPanel`) is a different thing: two plain
selects and a checkbox, then text lines per assignment ("Rama 2 files · v3 · 4 Nov, 4:19 … Done") and a Download all
button per assignment. You can't open a hand-in's files from it, sort it, or see counts.

**Why.** Submissions and Sprint materials were built as their own small lists (`OrgFilesPanel`), not on the Files
tab's list components.

**Design (as drawn).**
- **Header:** "Submissions" with **Download all ▾** (every assignment, or the one you're in).
- **Filter bar (same look as Task files):** Status: **All · In review · Returned · Approved · Late**, each with its
  live count; "Filter people…" search; an Assignment picker in the bar's menu, as Task files keeps its extra filters.
- **Columns:** Name · Handed in · Files · By — the same grid and header as Task files, sortable by name and time.
- **Level 1 — assignments as folders:** title, a badge ("1 TO REVIEW", "ALL APPROVED", "CLOSED"), latest hand-in
  time, files, who handed in last. ⋯ on a row: Download all for that assignment, Open in Tasks.
- **Level 2 — open an assignment:** one folder per person or group: name (avatars), "v2 · In review · Late",
  handed in, files. ⋯: Open in review (the queue on that person), Download.
- **Level 3 — open a person:** their handed-in files in the shared file list (`FolderListView` with a `collection`,
  as Task files' opened task), with the viewer, Download and earlier versions ("Version 1 · 4 Nov").
- Breadcrumb at the top of levels 2 and 3 ("Submissions › ALM-1 › Rama"), Back with Esc, the place in the URL
  (`filesView=submissions&assignment=…&copy=…`), as Task files keeps `taskId`.
- A team workspace's **Final files** (`ChildFinalFiles`) gets the same list: its group hand-ins as folders.
- Empty: "Nothing handed in yet"; no match: "No hand-ins match these filters" with Clear filters.

**Data.** Today's `readOrgSubmissionsAction` already returns each assignment's hand-ins (who, files count, version,
status, late). Add one read for a hand-in's files as file-list rows (`assignment_submissions.files` joined to
`workspace_nodes`, with size and updated time), checked by the same rule as the review queue (admins and reviewers;
group work stays readable where the queue can read it). Counts come from the same rows.

## 2. Sprint materials, the same way

**What happens.** Sprint materials (`SprintMaterialsView`) is a heading per sprint and a plain list of file links.

**Design.** The same browser as §1:
- Filter bar: **All · Running · Upcoming · Closed** with counts, and "Filter files…".
- Columns: Name · Last updated · Size · By.
- **Level 1 — sprints as folders**, named with their CO ("CO1 · Week 3–4"), a "NOW" badge on the running one, files
  count; COs and the sprints inside them in term order.
- **Level 2 — a sprint's files** in the shared file list (open, viewer, download); a material from the CO is marked
  "From CO1". Admins get **Add materials** (opens the sprint's materials picker, as on its Sprints page).
- Breadcrumb, Esc, place in the URL (`filesView=materials&sprint=…`).

**Data.** `readOrgSprintMaterialsAction` returns sprints and file ids; the files load as file-list rows through the
existing nodes read (`getNodesByIds`), which already applies who can open what (admins-only materials stay hidden).

## 3. The review queue as one card

**What happens.** The three columns (Waiting, the work, the discussion) are three separate bordered cards with gaps
between them; the selected person has an orange bar on its left edge and a tint — unlike everywhere else in the app.

**Design (as drawn).**
- **One card** — one border and radius around all three parts, split by **hairlines** (1px vertical dividers), no
  gaps and no inner cards. The parts keep their widths (240 · flexible · 340, 300 below 1280px) and their 12px
  padding; the file viewer and the discussion run to the card's bottom edge.
- **Selected person = the main navigation's selected item:** the same soft background (`--sidebar-accent`), 5px
  corner and full-strength text; others in the muted text colour, hover the same light wash. No orange bar.
- Everything else from the review queue report stays (headers level at the top, decision on the work's header, one
  file bar, discussion with the box at the bottom, keys, phones). On phones the parts stack inside the one card,
  separated by horizontal hairlines.

## 4. Done when

- Submissions: filter bar with counts, sortable columns, assignments → people → files with the shared viewer,
  breadcrumb, Esc and URL; Download all from the header and each folder's ⋯; same for a team's Final files.
- Sprint materials: sprints (with their CO) → files with the viewer; Add materials for admins; admins-only files
  hidden from members.
- Review queue: one bordered card, three parts split by hairlines, no gaps; the selected row matches the main
  navigation's selected style (same background, radius, text); no orange bar.
- Browser tests for each; DB test for the hand-in files read (who can and can't).

## 5. Decisions for the user

- **D1 · Submissions' first level.** Assignments as folders, then people (proposal), or people first?
- **D2 · Status words.** "Approved" for accepted work (as the board now says), or "Done"?
- **D3 · Earlier versions in a hand-in.** Shown inside the person's folder as "Version 1 · 4 Nov" rows (proposal), or
  only the latest?

## Built and checked (4 November 2026)

Everything above, on local main, not pushed; no migration. D1–D3 as proposed (assignments first; "Approved";
earlier versions as folders).

- **§1 Submissions** (`OrgFileViews.tsx`, on shared pieces in `OrgFileBrowser.tsx`): breadcrumb header with
  **Download all ▾** (each assignment; inside one, its own); Task files' filter bar (Status: All · In review ·
  Returned · Approved · Late with counts, Assignment picker, "Filter people…"); Task files' column header
  (`FolderListHeader`, now with a `sizeLabel`) — Name · Handed in · Files · By, sortable; the same row grid and folder
  chip. Assignments → people (v2 · status · Late; ⋯ Open in review, Open the hand-in) → their files and earlier
  versions → a file in the shared viewer. Esc goes up; `assignment`, `copy`, `version`, `file` are in the link.
- **§1 Final files** (a team workspace): the same browser — assignments → files with their review.
- **§2 Sprint materials:** Sprints filter (All · Running · Upcoming · Closed) and "Filter files…"; sprints as folders
  in term order, named with their CO, a NOW badge; a sprint's files plus its CO's, marked "From CO1"; **Add
  materials** for admins; Esc and `sprint`/`file` in the link.
- **Server:** `readOrgSubmissionsAction` rows add who handed in, where the copy lives, the photo and team; groups add
  `reviewRequired` and `closed`; "Approved" replaces "Done" where review is required. New `readHandInFilesAction`
  (download-submissions admins only; current files and earlier versions). `readOrgSprintMaterialsAction` adds dates,
  the CO, and each file's size, time and author. `readChildFinalFilesAction` adds the assignment id and the columns.
- **§3 Review queue:** one bordered card, the three parts split by 1px dividers (horizontal on phones), no gaps; the
  selected person uses the main navigation's selected style (tested equal), no orange bar.

**As built, differently from the wording above:**
- A person's files use the same row component as the folder levels (Task files' grid, chip and columns), not
  `FolderListView` itself: that list opens files inside the Files tab of the workspace you're in, while a group's
  hand-in lives in its team workspace — the shared viewer opens either.
- A person's ⋯ has **Open the hand-in** instead of a Download: the download route zips whole assignments; each file
  has its own Download in the viewer.
- **Download all ▾** lists each assignment (there's no single zip of every assignment).
- **Add materials** opens the sprint's page, where the materials picker is.

Tests: DB — Submissions rows, hand-in files and versions, member refused, materials with their CO. Browser — five
Files tests (filters and counts, columns, badges, menus, the levels with breadcrumb, Esc and links, materials, Final
files, phone, axe) and the review card test. Not checked here: your signed-in screens.
