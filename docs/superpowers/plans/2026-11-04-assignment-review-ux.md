# Assignment panel, Hand in and Review — Implementation Plan

> Native execution on local main, TDD, one local commit per phase, no push. Spec: `docs/superpowers/plans/2026-11-04-assignment-review-ux-findings.md` (every finding number below is from it).

**Goal:** the teacher gets a full Assignment tab, the student a clear Hand in card, and both a single, proper review — every finding in the report closed.

**Architecture:** no new tables. Server actions gain the fields the screens need; three shared client pieces (`AssignmentTab`, a redesigned `HandInSection`, `ReviewDecision` + `ReviewWork`) are used wherever the same job appears.

## Global constraints
- No migration; lists from SQL through `to_jsonb`/`jsonb_agg` (production `fetch_types: false`).
- One word per thing (5.1): **Hand in / Hand in again / Update hand-in** (link and text only) / **Mark as done**; **Return** (never "Request changes" on a copy); **Approved** (reviewed) vs **Done** (no review); board column stays Completed.
- Chips come from one function for copies (`handInChip`), everywhere (5.2).
- Members never get teacher controls; the server already refuses them.
- Layers via the shared primitives only; phone width 390 px works for each screen (5.4).

## Phase 1 — bugs and the panel's structure
| Finding | Change |
|---|---|
| 1.8 | Server: `assignmentWriteBlock` refuses title, description, priority, due date and story points on a main assignment through the task field path ("Use Edit for everyone, so every copy changes."). Details on a main assignment shows them read-only with an **Edit for everyone** button. |
| 2.1, 3.12 | The generic "In review" box never shows on an assignment copy. |
| 1.12 | The tab bar takes any number of tabs (`grid-flow-col auto-cols-fr`). |
| 1.13 | `listAssignmentsAction(orgId, { masterId })` reads one assignment. |
| 1.9 | Adding a step on a main assignment adds it to every copy (`createSubtaskAction` → `addAssignmentStepAction`); the tab says so. |
| 1.10, 1.11 | The main assignment's Comments and Files tabs say what they are (brief and questions; materials students open read-only). |
| 1.7 | The main assignment's header chip reads Draft / Scheduled / Open / Closed. |

## Phase 2 — the Assignment tab (admins, main assignments)
New `assignment` tab, first and default for admins on a main assignment; the Details box goes.
| Finding | Change |
|---|---|
| 1.1 | Full-height tab: header (due, Open/Closed, Manage ⋯), tiles, toolbar, people. |
| 1.2 | One list in sections: Waiting for review · Returned · In progress · Not started · Missing · Approved · Done · Excused, each with a heading and count. |
| 1.3 | Full roster's tools move in: bulk select (Approve / Return / Extend / Remind selected), Give to, Add step, Change decision, Excuse / Un-excuse, Remove, team moves; the pop-up goes. |
| 1.4 | Search by name, sort (name, handed in, state), Late only. |
| 1.5, 6.2 | Photos (`RosterRow.userId`, `avatarUrl`), last activity, team rows with their people (★ lead) and who handed in. |
| 1.6 | Per row: Open (the copy, with "Back to the assignment"), Approve, Return (reason + Fix by), Remind, Extend, ⋯. |
| 1.10 | Class questions as the tab's last section. |
| 1.14 | Remind says how many will be skipped before the click ("Remind 7 · 2 reminded in the last 12 hours"). |
| 5.5 | Section headings and labelled lists. |

## Phase 3 — the Hand in card (members)
| Finding | Change |
|---|---|
| 2.3 | Header: "Hand in" + chip; separate lines for what's asked, due (zone) and late rule, reviewer. |
| 2.4 | One state box with its next action inside it; then files, steps, note, the primary button. |
| 2.2, 2.15 | Files listed once: the handed-in version when locked, the working files when open; no empty line. |
| 2.5 | The button says why it's off ("Add a file to hand it in."). |
| 2.6 | No replace while waiting for file hand-ins; link/text get **Update hand-in**. |
| 2.7 | Steps checklist on the card (tick here); unticked steps warn before Hand in. |
| 2.8 | Materials open in the file viewer. |
| 2.9, 3.14, 3.15 | History under the card: each version, who handed it in, each return (who, reason), the approval (who, when). |
| 2.10 | Accepted size shown; uploading shows the file name and a progress state; a failed upload says why when it can. |
| 2.11 | "Message your teacher" and "Class questions" open the conversation from the card. |
| 2.12 | On a copy, the task properties fold under "More details"; the code editor stays (coding labs). |
| 2.13 | Excused, closed and missing get boxes with a next step. |
| 2.14 | Link must be a web link; text shows a character count. |
| 4.6 | Each file can be previewed in place (same viewer). |

## Phase 4 — review
| Finding | Change |
|---|---|
| 3.1 | Right column: note, steps, conversation, then the decision at the bottom. |
| 3.2, 4.4 | File switcher for every file. |
| 3.3, 4.3 | Versions open their own files; **Compare** puts an earlier version beside the current one. |
| 4.1, 4.2, 4.5 | File bar (name, size, handed in, Download, Open in new tab, Full screen); the viewer fills the column. |
| 3.5 | Steps listed by name with ticks; hidden when there are none. |
| 3.6 | Reply to the conversation in place. |
| 3.7 | Recent return reasons as one-click chips; Fix by defaults to the later of the due date and three days on. "Attach a file" is the conversation reply (comments take files) — see ruling. |
| 3.8 | Search by name; sort oldest / newest / late first. |
| 3.9 | Approve and Return wait 10 s with Undo before they're sent (`deferredFeedback`). |
| 3.10 | The queue has its own heading; the board's toolbar buttons hide while it shows. |
| 3.11 | Links show as a card (site, title); text keeps its formatting. |
| 3.12, 3.13 | An opened copy that's waiting shows the same `ReviewDecision` (Approve / Return with Fix by) and "Next waiting" / "Back to queue". |

## Phase 5 — across all three
5.1 words and 5.2 chips applied to the board card, panel header, Hand in, roster and queue; 5.3 tab notes (Phase 1); 5.4 phone checks in browser tests; 5.5 headings; 5.6 the panel's single read (Phase 1, 1.13).

## Tests
Unit (pure helpers + source contracts), DB (each server field and refusal), browser (Assignment tab, Hand in states, review screen, phone width). Full gate before each commit.
