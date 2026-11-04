# Review queue: three columns, cleaned up — findings, 4 November 2026

Source: the user's screenshot of CSE 3B → Tasks → In review on localhost (Rama · ALM-1, a PDF hand-in), and the code
(`ReviewQueue` in `AssignmentsPanel.tsx`; `ReviewWork`, `ReviewSteps`, `ReviewDiscussion`, `ReviewDecision` in
`ReviewQueueParts.tsx`; `FileViewer`; `CommentsTab`). No code changed.

## 0. What was asked

| The user's words | Section |
|---|---|
| "It says private conversation, but it's showing the discussion… change the name to Discussion" | §3 |
| "Add note (optional)… placement somewhere else, the right side should be completely discussion" | §2, §3 |
| "Improvements on the three sides — left, middle and right — placements, alignment, everything" | §1–§4 |

---

## What's wrong today (from the screenshot and the code)

- **Right column does four jobs:** their note, steps, the conversation and the decision (note + Approve / Return /
  Open), stacked in 300px. The decision sits at the very bottom, under the floating chat button.
- **Two headings for one thing:** "PRIVATE CONVERSATION · 2" and, inside it, the comments' own "DISCUSSION 2 ↑↓
  OLDEST".
- **The comment box is at the top and doesn't fit:** the Comment button is cut off at the right edge and "Press ⌘↵ to
  post" wraps over three lines (the panel's composer was built for a wider panel).
- **Middle column says the same things twice:** the file bar has Download · Open in new tab · Full screen, and the PDF
  viewer's own toolbar under it has Download · Open in tab again. That toolbar floats over the page (it covers the
  document's top line), and "1 / 7" wraps onto two lines. The file name is cut to "Nagaraj-…".
- **The header line** ("Rama · ALM-1 · 12 hours ago · Version 1") is plain text with no Late mark and no actions
  near it; the decision is two columns away.
- **Left column** is a narrow text list: no avatar, Late hidden in the meta line, "1 of 1 ‹ Next" with a lone ‹ and a
  word button, and nothing tells you the keyboard works (J/K, A, R).

## 1. Left: who's waiting

- Header: **Waiting · 6** with **‹ 1 of 6 ›** (two arrow buttons, same style), and the line "J / K to move" under the
  list (shown once, quiet).
- Each row: avatar (or team initials), name, then "ALM-1 · 12h · v1" in mono; **Late** and **Resubmitted** as small
  chips on their own line; the current row has an orange left bar and a tinted background.
- Width 240px (from 220); the list scrolls inside the column.
- When the last one is decided: **All caught up** with "Back to the board".

## 2. Middle: the work, with the decision on top

- **One header line** over the work: avatar · **Rama** · ALM-1 · handed in 12 hours ago · Version 1 · *Late* chip —
  and on the right **Return** · **Approve** (primary) · **⋯** (Open the hand-in, Copy link). Keyboard A / R still work.
  Approve and Return keep the 10-second Undo toast.
- **Their note and steps** move here, under the header, as one quiet line: *Their note: "Used two pointers" ·
  Steps 4 of 5 ▾* (Steps opens the list in place). They're part of what was handed in, so they sit with the work.
- **The note on approve** (today's "Add note (optional)" field) moves into Approve: **Approve ▾ → Approve with a
  note…** opens a small box under the button; the note still posts into the discussion, as today (decision D1).
- **Return** opens the existing reason box (recent reasons, Fix by) under the button, not at the bottom of the page.
- **One file toolbar:** file tabs (full names, truncated only at 18rem), version, Compare, then ‹ 1/7 › · − 120% +
  · Download · New tab · Full screen — once. The PDF viewer's own floating toolbar is hidden here; the page counter
  never wraps. The viewer takes the rest of the column's height, nothing on top of the document.
- Links and text hand-ins (no file) show in the same place, under the header.

## 3. Right: only the discussion

- Heading **Discussion · 2** with the sort (↑↓ Oldest) on the same line — one heading, not two. (Still the copy's
  own comments, between the student and reviewers; class questions stay in the copy's panel.)
- The thread fills the column and scrolls; **the comment box sits at the bottom** (chat style), full width of the
  column, placeholder "Write to Rama…", **Send** fits inside; ⌘↵ shown as a tooltip, not a wrapped line.
- Nothing else in this column.

## 4. Whole screen

- Columns: 240px · flexible · 340px (from 220 · flexible · 300); 16px gutters; all three start on the same line under
  the filters and fill the screen; each scrolls inside itself.
- The floating chat button no longer covers anything (the decision moved to the top).
- Below 1280px the discussion narrows to 300px; below 1024px the left list becomes a "Rama · 1 of 6 ▾" picker over the
  work; phones stack: picker, header with the decision (sticky at the top), the work, the discussion.
- Everything keeps its names for screen readers: regions Waiting, Submission, Discussion; the decision is a group
  "Decision".

## 4a. Spacing and alignment (second visual, after the user found the first one tight)

- **8px grid.** Column padding 12px; 16px between columns; 12–14px between blocks inside a column; 16px between
  messages in the discussion; 4px between waiting rows.
- **One top line for all three columns:** each starts with a 24px header row — "WAITING · 6 ‹ 1 of 6 ›", the work's
  header, "DISCUSSION · 2 ↑↓ Oldest" — so the three tops line up exactly.
- **Never wrap a label:** names, file names and meta lines are one line with an ellipsis (full text on hover); the
  page counter, zoom and file actions keep their width; buttons are 30px high, 12px side padding.
- **Waiting rows:** 24px avatar · name (13px) over meta (mono 11px); Late sits on the name's line at the right; the
  current row has a 3px orange left bar and a tinted background; the keys hint sits under a hairline at the bottom.
- **Work header:** 32px avatar · name (15px, medium) over "ALM-1 · handed in 12 hours ago · Version 1" (mono 11px);
  Return · Approve ▾ · ⋯ on the right, 8px apart. Their note and Steps share one tinted 8px-padded strip under it.
  The file toolbar is one 36px row: name · size, then counter · zoom · Download · New tab · Full screen, 14px apart.
- **Discussion:** 24px avatars, name · time on one line, text under it, Like · Reply under that; the composer is a
  bordered box at the bottom: placeholder on top, "@ mention" left and Send right on the line below — Send never
  clipped.

## 4b. Other gaps found in the queue, and their fixes (audit of the code, same day)

The user approved the spaced design (§4a) and asked for the remaining gaps. Each is from the code
(`ReviewQueue`, `readReviewQueueAction`, `reviewAssignmentCopyAction`, `ReviewQueueParts`).

1. **The person you're reviewing can change under you.** The queue reloads on every notice (`useReloadOnNotice`)
   and keeps its place by *position* (`index`), so a new hand-in sorted above the current one silently swaps who is
   shown — mid-review, with Approve under your finger.
   **Fix:** keep the place by the copy (`copyId`), never by position. New hand-ins don't reshuffle the list: a pill
   at the top of Waiting says **"2 new · Show"** and adds them when clicked (or when the list is empty).
2. **Only the first 300 load.** The read stops at 200 hand-ins plus 100 tasks; the rest only show as
   "200 of 340 loaded" and are unreachable until others are decided.
   **Fix:** page by handed-in time (keyset on `review_submitted_at, id`); the list loads the next 200 when you're
   within 10 of the end, and a **Load more** row covers keyboards and screen readers.
3. **No place in the URL.** Reloading or sharing loses who you were reviewing.
   **Fix:** `?taskScope=review&review=<copy>` follows the current one (replace, not push, so Back still leaves the
   queue); the browser tab reads "Review · Rama · ALM-1".
4. **The thread doesn't tell the story.** Returns and approvals live in activity and notifications, not in the
   discussion; on a resubmission the reviewer can't see what was asked.
   **Fix:** the discussion shows decisions as quiet lines in the thread — "Returned by Ramanayudu: fix the README ·
   fix by Nov 13", "Version 2 handed in", "Approved" — read from the copy's activity, not new comments. On version 2+
   the note strip under the header adds "Asked last time: fix the README" and the toolbar's **Compare** is on by
   default for the same file name.
5. **New messages from the student don't show in Waiting.** The row has a comment count but no "new".
   **Fix:** a dot and "New message" on the row's meta line when the student wrote after you last opened it (the
   board's read receipts, `task_read_receipts`); opening the row marks it read.
6. **Late says nothing about how late.** Only a "Late" chip.
   **Fix:** the header's meta adds "due Nov 3 · 2 hours late"; the chip stays on the waiting row.
7. **Group hand-ins hide the group.** A team copy shows "Team Falcon" and "handed in by Asha" in a run of text.
   **Fix:** the header shows the team's avatars (up to 4, +N) and "handed in by Asha"; the composer says
   "Write to Team Falcon…".
8. **Ordinary tasks in the queue show nothing to review.** A board task waiting for review (`kind: 'task'`) has no
   file, so the middle column is empty apart from "Marked as done, nothing attached".
   **Fix:** show the task's description and its final files (the task's own deliverables) in the middle column, with
   the same toolbar; "Nothing attached" becomes a proper empty state in the viewer's place.
9. **An approve note can vanish.** After Approve, the note is posted with errors ignored (`.catch(() => undefined)`).
   **Fix:** if the note fails, say so in the Undo toast's place ("Approved — your note didn't send. It's in the
   discussion box.") and put it back into the composer.
10. **Two reviewers on one hand-in.** "Already reviewed by Priya" handles the clash after the fact.
    **Fix:** show "Priya is looking at this" on the work's header and a small dot on the waiting row, from the
    presence the discussion already uses for typing; nothing is locked.
11. **Empty and filtered states are bare text** ("All caught up.", "Nobody matches.").
    **Fix:** a proper empty state in the middle column — "All caught up" with **Back to the board**; "Nobody
    matches these filters" with **Clear filters**.
12. **Filters don't match each other.** Mine · All are tiny bordered words; Late only is a bare checkbox.
    **Fix:** every filter is the same 30px control: Search names, Assignment ▾, Sort ▾, **Late only** and
    **Mine · All** as small toggle buttons of the same height.

Also fixed by §1–§4: after Approve or Return, focus moves to the next person's header and a screen-reader line says
"Now reviewing Asha Nair, 2 of 6"; **?** shows the keyboard shortcuts (J / K, A, R, Esc).

Not in scope (said so the gap is closed on purpose): grades or rubrics (there's no grading model yet), bulk
approve from the queue (the roster's "Approve all submitted" covers it).

## 5. Done when

- The right column holds only Discussion (one heading) with the composer at the bottom and Send fully visible at
  340px and 300px.
- Approve, Return and ⋯ sit on the work's header line; Approve with a note posts the note into the discussion; A, R,
  J, K and Esc still work; Undo still works.
- Their note and steps show under the header; the file has one toolbar, nothing overlapping the document, "1/7" on
  one line.
- Waiting rows show avatar, name, assignment, age, version and Late; ‹ 1 of 6 › and "All caught up".
- No sideways scroll at 390px; axe clean; browser tests updated for the new places.
- §4a spacing: the three column tops line up (same y), no label wraps at 1280px and 1440px, Send is fully visible.
- §4b: a new hand-in arriving mid-review never changes who is shown (browser test); more than 300 waiting all load
  (DB test on paging); `?review=` reopens the same person; the thread shows the Returned and Approved lines;
  a new student message marks the row; late shows "N hours late"; a group shows its avatars; an ordinary task shows
  its description and files; a failed approve note comes back to the composer; "Priya is looking at this" shows for a
  second reviewer; empty and no-match states have their buttons; all filters are 30px.

## 6. Decisions for the user

- **D1 · The approve note.** Inside Approve ("Approve with a note…", proposal), or drop it — write in the discussion,
  then Approve?
- **D2 · Their note and steps.** Under the work's header (proposal), or at the top of the Waiting row's details?
- **D3 · Return's reason box.** Opens under the Return button (proposal), or as a small dialog?

## Built and checked (4 November 2026)

Everything above, on local main, not pushed; no migration. D1–D3 as proposed. The queue moved to its own file
(`ReviewQueue.tsx`); `AssignmentsPanel` re-exports it.

- **§1 Left:** "WAITING · N" with ‹ 1 of N ›; avatar · name · Late / Resubmitted · mono meta; "New message" and
  "Priya is here" lines; orange left bar on the open row; Load more; the keys line under a hairline; "All caught up"
  with Back to the board.
- **§2 Middle:** the header holds avatar(s) · name · "Lab · handed in … · Version N · by Asha · due Nov 3 · 2 hours late"
  and **Return · Approve ▾ · ⋯** (Open the hand-in, Copy link); Return and "Approve with a note…" open boxes right
  under the buttons. Their note · Asked last time · Steps ▾ in one tinted strip. **One file bar:** the PDF viewer's
  page and zoom are drawn into `FileViewer`'s bar (`controlsTarget`), its floating toolbar isn't drawn; Download ·
  New tab · Full screen once. Links, text, an ordinary task's description and "Nothing attached" sit in the same place.
- **§3 Right:** `CommentsTab` in chat mode — one "Discussion · N" heading with the sort, the thread, the box at the
  bottom ("Write to Rama…", Send, ⌘↵ as a tooltip), the decision lines placed in the thread by time.
- **§4, §4a:** 240 · flexible · 340 (300 below 1280); one 8px grid; the three column tops are level (tested at 1440
  and 1280); every filter 30px; below 1024 a "Waiting" picker; phones stack with the header and decision sticky.
- **§4b:** 1 place kept by the hand-in (+ "N new · Show"); 2 pages of 200 by handed-in time (`nextCursor`), loading
  near the end, Load more; 3 `?review=` and the tab title; 4 decision lines and "Asked last time", Compare on for a
  resubmission; 5 "New message" from read receipts, marked read on open; 6 "N hours late"; 7 team avatars and
  "Write to Team Falcon…"; 8 an ordinary task's description and files; 9 see below; 10 "Priya is looking at this"
  (and on the open row in the list) from the copy's presence room (`useRoomViewers`); 11 empty and no-match states;
  12 one control height. Focus moves to the next person's name and a screen-reader line says who; **?** lists keys.
- **§4b.9, changed while building:** the note is sent *before* approving. If it can't be sent, nothing is approved,
  the hand-in comes back on screen and the note is put back in the discussion box ("Your note didn't send, so it
  isn't approved yet…"). Approving first and then losing the note was the problem; this order can't lose it.
- **§4b.10, scoped:** the dot shows on the open row only — watching every row's presence room would open one live
  connection per hand-in.

Tests: DB — paging past 200 (252 hand-ins, two pages, none twice), the story lines, unread and read, an ordinary
task's description and files. Browser — 16 queue tests (layout, alignment, Approve with a note, a failed note, a
mid-review arrival, `?review=`, paging, unread / late / group / presence + axe, keys and empty states, ordinary task,
phone). Not checked here: your signed-in screens and live presence between two real browsers.
