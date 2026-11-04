# Assignment panel, Hand in and Review — UX findings, 4 November 2026

The three areas the core workflow runs through: the teacher's view of an assignment, the student's Hand in card, and
review (the teacher deciding, the student seeing the decision). Sources: the live site today (teacher in the app's
browser, student in Chrome, one full return → resubmit → approve loop on Home assignment 1), the mockup canvas
(Board, Review, Submit artboards) and the code. No code changed.

## 1. The assignment panel for admins → its own "Assignment" tab

What the teacher gets today when they open an assignment: the generic task panel (Details, Subtasks, Comments, Files),
with a small "Assignment" box at the top of Details holding four tiles, two short lists, and buttons. Everything else in
Details is the ordinary task form.

| # | Finding | Why it matters |
|---|---|---|
| 1.1 | The class view is squeezed into the top of Details, under the panel's header, above Description and Properties. | The teacher's main job on an assignment (who's in, who isn't) shares a scroll with a task form. |
| 1.2 | Only two lists: Waiting for review and Not in yet. Approved, Done, Returned and Excused people have no list (Done and Excused appear only when their tile is clicked; Returned is lumped into Not in). | The mockup's question "who approved, who was sent back" has no answer without Full roster. |
| 1.3 | Full roster is a separate pop-up window with a different layout, different buttons (Change decision, Excuse, Give to, team moves, Add step, bulk select) and its own copy of the list. | Two places, two designs, for one roster. The panel and the window disagree until a reload (fixed locally in d6107ac51, but the split remains). |
| 1.4 | No search, sort or filter by name in the panel's lists; no "Late" filter; order is load order. | A class of 40+ needs to find one student. |
| 1.5 | Rows show initials, not photos; no last activity; team rows show only the team name. | The mockup has avatars; the Members tab has photos. |
| 1.6 | From a waiting row: Open and Approve only. Return needs Full roster or the queue. Open leaves the assignment for the student's copy, with no way back. | The commonest decision pair (Approve / Return) is split across screens. |
| 1.7 | The panel header chip reads COMPLETED / IN PROGRESS for the main assignment — a state derived from the copies, shown like a task status. | Reads as if the teacher finished something. |
| 1.8 | **Bug:** editing the title, description, priority or due date in Details changes only the main assignment; the students' copies keep the old values. Only Sprint carries over. "Edit for everyone" (in the ⋯ menu) is the path that updates copies. | A teacher who moves the due date in the obvious field leaves every student on the old date. |
| 1.9 | Subtasks tab on the main assignment vs "steps": adding a subtask there touches only the main task; steps for everyone are added in Full roster ("Add step"). | Two meanings of the same list. |
| 1.10 | Comments tab on the main assignment is the brief/Q&A; "Class questions" is also a link inside the Assignment box; students see Class questions as a sub-tab of their Comments. | Three entry points for one conversation. |
| 1.11 | Files tab on the main assignment vs "Materials" set at creation. | Same split as 1.9. |
| 1.12 | The tab bar is a fixed four-column grid (`grid-cols-4`); a fifth tab needs the layout changed, and at 580 px each label gets narrower. | A design constraint for the new tab. |
| 1.13 | The panel loads every assignment in the organization (`listAssignmentsAction`) to find one row, then the roster separately. | Grows with the number of assignments; two reads that can disagree. |
| 1.14 | Remind skips anyone reminded in the last 12 hours, and says so only in the toast after the click. | The button promises "Remind 7" and reaches fewer. |

## 2. The member's Hand in card

What the student gets: inside Details, a "Hand in" box (chip, one long line of what's asked, due, late rule and
reviewer; "Set by…"; a state box; the latest version's files; the current files; drop zone; Manage files; note; Submit),
followed by the rest of the task form.

| # | Finding | Why it matters |
|---|---|---|
| 2.1 | **Two review boxes on one copy.** After handing in, the copy also shows the generic task "In review" box: "Waiting for an owner or admin to approve. Final files are added to Files separately.", with its own "Submit again" link for the student and Approve / Request changes for admins. | Contradicts the Hand in card ("Replace submission", "Return"), and the files sentence is wrong for a hand-in. |
| 2.2 | The same file is listed twice while waiting or returned: once under "Version N", once under the current files. Seen live: HYD-VIJ-31-10-26.pdf twice. | Looks like two copies were uploaded. |
| 2.3 | What's asked, the due date (with zone), the late rule and the reviewer run as one sentence that wraps over two lines. | Hard to scan; the mockup puts due and late on a meta line under the title. |
| 2.4 | The state box sits between the header text and the files, but the call to action (Submit) is at the bottom after the note; on a returned copy the reason is in the middle and "Submit again" far below. | The next step isn't next to the thing that asks for it. |
| 2.5 | Submit is disabled without a file and says nothing about why. | Students don't know what's missing. |
| 2.6 | "Replace submission" stays while waiting for review, though the files are locked; on a file hand-in it can only resend the same files. | A button that can't do what it says. |
| 2.7 | Steps (the assignment's checklist) live in the Subtasks tab; the Hand in card doesn't show them or how many are ticked, but the reviewer sees "Steps 4 of 5 ticked". | Students can hand in without seeing what's checked. |
| 2.8 | Materials show as plain names ("Materials: a, b"), not links. | Students can't open them from the card. |
| 2.9 | Only the latest return reason shows. Earlier versions, earlier decisions and who approved, and when, aren't on the card; a reviewer's approve note goes to Comments, not to the card. | The student's history of their own work is scattered. |
| 2.10 | No upload progress, no accepted types or size limit stated; a failed upload says "Try again" only. | Large files look stuck. |
| 2.11 | The Comments tab (private with teachers / class questions) is separate from the card; the mockup puts both under the hand-in. | Asking about the work is a tab away from the work. |
| 2.12 | The rest of Details under the card (Description, Status, Section, Priority, Sprint, Due date, story points) shows to students, mostly locked; "Open in VS Code" sits in the header. | Clutter around the one thing the student came to do. |
| 2.13 | Excused, closed and missing states are one plain sentence each, with no box and no next step (e.g. "Ask for an extension"). | Inconsistent with the coloured boxes of the other states. |
| 2.14 | Link and text hand-ins: the link field has no check that it's a real web link before Submit; the text box has no character count. | Avoidable returns. |
| 2.15 | Under locked files the card leaves a small empty line (deferred minor from the mockup work). | Visual. |

## 3. Review

### 3a. The teacher's Review queue

| # | Finding | Why it matters |
|---|---|---|
| 3.1 | Approve, Return, the note box and the keyboard hint sit at the top of the right column, above the conversation; the Return reason box opens in the same spot and pushes the rest down. The mockup puts the decision at the bottom of the right column, under note, steps and conversation. | The decision comes before reading what's needed to make it. |
| 3.2 | Only the first file previews. Others are listed as text ("Also: …"), not clickable. | A two-file hand-in can't be reviewed fully. |
| 3.3 | The Versions list only lists; picking an earlier version does nothing, and there's no compare. | "What changed since I returned it?" has no answer. |
| 3.4 | The preview box is a fixed 60 % of the screen height, without the Files tab's file bar (name, size, who updated, full screen, open in a new tab, version history, compare). Left-edge clipping is fixed locally (d6107ac51). | The Files tab's viewer is richer than the review's for the same file. |
| 3.5 | Steps show as a count ("Steps 0 of 0 ticked"), not which ones; it prints even with no steps. | Noise, and no detail when it matters. |
| 3.6 | The conversation is read-only (the last three messages); replying means opening the copy. | Feedback is the point of review. |
| 3.7 | The Return reason has no presets and no "attach a file"; Fix by defaults to three days on, not to the due date when that's later. | Repeated typing; a Fix by before the due date can shorten a student's time. |
| 3.8 | No search by name; order is oldest first only; "Mine / All" appears only with reviewers set. | Big classes. |
| 3.9 | After a decision the next person opens with no undo; a mistaken Approve needs Full roster → Change decision. | One slip is several clicks to undo. |
| 3.10 | The queue replaces the board when In review is chosen, under the board's toolbar (New task, columns); the toolbar's buttons don't apply there. | The queue doesn't look like its own place. |
| 3.11 | Link and text hand-ins show as a raw link or a grey block, with no preview of the page or formatting. | Uneven with files. |

### 3b. Reviewing from a student's copy (Open)

| # | Finding | Why it matters |
|---|---|---|
| 3.12 | Opening a copy shows the generic "In review" box with Approve / **Request changes** (not "Return"), no Fix by, and no preview of the files inside it — a different review UI from the queue. | Two review designs, two words for one action. |
| 3.13 | No "Next waiting" from a copy; back to the queue is the browser's Back. | Breaks the review flow. |

### 3c. What the student sees after a decision

| # | Finding | Why it matters |
|---|---|---|
| 3.14 | Returned: the red box shows the latest reason and Fix by — good. Approved: "Approved · handed in …" with no reviewer name, time or note. | The student doesn't see who approved or what they said. |
| 3.15 | The notification for a return or approval opens the copy; there's no in-card "What changed" (version, decision, reason) timeline. | Same as 2.9. |

## 4. The preview engine (Files tab parity)

The review already mounts the same engine (`UniversalPreviewEngine`): PDF, Word/RTF/ODT, sheets, slides, images,
video, audio, archives and a binary inspector. The gaps are around it, not in it:

| # | Finding |
|---|---|
| 4.1 | No file bar (Files tab `MetadataStrip`): name, size, updated by, actions. |
| 4.2 | No full screen or open-in-new-tab for every type (only the PDF driver has its own). |
| 4.3 | No version history or compare (`FileVersionHistoryPanel`, `FileVersionCompareView`) — the Files tab has both. |
| 4.4 | One file at a time with no file switcher (3.2). |
| 4.5 | Fixed height; on phones 50 % of the screen. |
| 4.6 | The student's own Hand in card has no preview of what they're handing in (they see names and sizes only). |

## 5. Across all three

| # | Finding |
|---|---|
| 5.1 | Words differ for one thing: Return / Request changes / Send back; Submit / Submit again / Replace submission / Mark as done; Done / Completed / Approved. |
| 5.2 | Teacher and student see different chips for the same state (board card, panel header, Hand in chip, roster label). |
| 5.3 | The main assignment's Details, Subtasks, Comments and Files tabs each mean something slightly different from a normal task (1.8–1.11), with no explanation in the panel. |
| 5.4 | Phone width: the four tiles go to two columns; the Assignment box, Hand in and review stack, but nothing was designed for a phone first. |
| 5.5 | Accessibility: the tiles' state is in colour and number (fine), but the lists have no headings for screen-reader jumping; the queue's three regions are named, the panel's lists aren't landmarks. |
| 5.6 | Loading: each area does its own reads (assignment list, roster, hand-in, review state, files) — slow on a cold server and liable to disagree briefly. |

## 6. What will bite next

| # | When | What |
|---|---|---|
| 6.1 | 40+ students | No search/sort in the panel or queue (1.4, 3.8); the panel loads every assignment (1.13). |
| 6.2 | Teams | Team rows and team hand-ins ("submitted by Asha for Team A") are text only; no team members in the row. |
| 6.3 | A teacher fixes the due date in Details | Students keep the old date (1.8). |
| 6.4 | Several files per hand-in | Only the first previews (3.2). |
| 6.5 | Second and third versions | No compare, no history on the card (3.3, 2.9). |

## Suggested direction (for the plan, after your requirements)

1. **Assignment tab** (admins only, on main assignments): full-height class view — tiles that filter, search and sort,
   one list with sections (Waiting · Returned · Not started · In progress · Approved · Excused), photos, Approve /
   Return / Remind / Extend / ⋯ per row, bulk select, Review N, Download all, Export. Full roster's tools move in; the
   pop-up goes. Details on a main assignment edits for everyone (fixes 1.8).
2. **Hand in card**, redesigned as the mockup's Submit artboard: header (title, chip, due · late meta), one state box
   with the next action inside it, files once with preview, steps checklist, note, one primary button with a reason
   when disabled, history underneath; the generic "In review" box goes for copies (2.1).
3. **Review**: decision at the bottom of the right column; every file switchable in the middle; the Files tab's file
   bar, full screen and version compare; reply to the conversation in place; one review design used by the queue and
   by an opened copy, with Next.
