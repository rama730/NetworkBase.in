# Step 13 — Tasks

Report: 5.6, 7.7, 16.1, 17.4, 18.3, 23.1–23.5, 25.7, 29.3, 30.7, 32.4, 32.5, 32.7, 33.5, 34.3–34.7, 36.6, 42.5, 42.12–42.14, 44.3, 45.3.
Decisions 6, 10, 14–17, 25, 38–40, 47, 64, 68, 74, 76, 78, 82, 83, 85, 88, 89, 98, 113, 120, 125–128, 139, 148, 166, 168, 171. Problems 8, 9, 10, 19, 33; smaller bugs 18, 19.
The state and role tables in 42.13 are the rules (148). Organization changes stay scoped to organizations and copies; a shared change gets a normal-workspace test.
Seven commits, server first.

## 13a — Handing in (server)
- 0054 `assignment_submissions` (DB9, decision 127, problem 9): one row per hand-in: copy, version, who, when, link, text, note, file ids, late. Submit writes it; the copy keeps its latest.
- Submit takes an optional note (≤500). Replace submission until reviewed; with no review, until the due date. Approved stays locked.
- Return asks for Fix by, 3 days by default (126, problem 8): the copy's own due date moves there, so they can resubmit; Late only after it.
- Late after (171): `lateAfterMinutes` on the main assignment's settings, 15 by default, 0–60; Late compares against due + this.
- Change a decision: an approved copy can be returned while the assignment is open (40). Reopen a closed assignment (40); Extend on a closed assignment can reopen it for that person (bug 18).
- Give to (88): a copy for someone without one, with a due date; they're told.
- A database test that normal review is unchanged (42.18 #5).

## 13b — Publishing (server)
- Publish now, When the sprint starts, On a date, or Save as draft (125); the hourly job publishes the scheduled ones.
- Materials on the main assignment, read only on each copy (128, problem 10).
- "From" falls back to the organization when the creator has left (98); drafts say "Draft by".
- The scale test counts the notices and emails one publish writes (168).

## 13c — Editing and the roster
- Edit for everyone, field by field (23.3, 39): hand-in type locks at the first submission; steps add only; sprint, priority and points reach every copy; "Tell everyone?" for instructions.
- Roster: Remove a copy nobody started, Extend or Return selected, Export, Use again (33.5).

## 13d — Groups
- Auto-made groups avoid blocked pairs quietly (64); Copy groups from an earlier assignment; late joiners show under "Not in a group" and admins are told (47).

## 13e — One board
- One board: assignment cards sit in fixed columns by their counts, show class progress, never drag (14, 38); members see only their own copy (15).
- One form: New task; many people turns it into an assignment (6, 10, 25). Team tasks in the same form in a workspace (89); locked fields marked on group work (17.4, 18.3).
- Problem 33: the badge, In review filter and queue read one list. Bug 19: the line above the board goes on organizations.
- Problem 19: organization admins create, move and assign in a workspace, marked `Viewing as admin` (139).

## 13f — Review and conversations
- The review queue: one at a time with Previous and Next, keys A, R, J, K, Esc, bulk Approve and Return, awkward cases (23.2).
- Class questions and the private conversation on a copy (16, 23.5).

## 13g — The rest
- Due dates entered in the organization's zone and shown in yours (74). Live roster and queue (76). Phones (78).
- My work's Submitted filter with Download (68). Publishing progress (44.3).
- The temporary switch while real classes run (113, 166): `NB_ORG_BOARD_CLASSIC=true` gives members the main card back on their board. Remove after the pilot.
