# Board, Messages, review, New task and two-level sprints — Implementation Plan

> Native execution on local main, TDD, one local commit per phase, no push. Spec:
> `docs/superpowers/plans/2026-11-04-board-review-task-sprint-levels-findings.md` (§1–§7, decisions as built).

## Phase 1 — board (§1)
`patchTaskQueryData` never inserts an assignment copy into a list that lacks it. Unit test on the cache rule;
browser check that opening a copy leaves one card.

## Phase 2 — Messages (§7)
`groupChatWorkspaces(projects, channelsByWorkspace)` in `chat-rules.ts`: organizations with their teams; outside
teams on their own. Both sidebar views use it; team rows inside the organization's group / Channels section under
"Team workspaces"; one-channel teams as a channel row, more as an expandable row; counts roll up; headings in the
interface font.

## Phase 3 — review (§2, §3)
Reviewing: one toolbar line (queue filters left, board tabs right, In review count); no heading row; "1 of N ‹ Next"
atop the waiting list; columns fill the screen; the right column shows `CommentsTab` with
`useTaskDiscussionResource` for the current row.

## Phase 4 — tabs and New task (§4, §5)
`UnderlineTabs` from `ProfileTabs`, used by the profile, New sprint (One · Several) and New task (Task · Assignment).
New task's Assignment tab renders the assignment form (`AssignmentFields`); Assigned to lists people only; + New gains
Assignment; "Use again" opens the same dialog on the Assignment tab.

## Phase 5 — two-level sprints (§6, D1–D9)
Server rules (main sprints don't overlap; sprints inside fit their main sprint and don't overlap each other; no
deeper level; team sprints inside a main sprint or a sprint in it); the rail nests sprints in their main sprint; the
main sprint's page (strip, roll-up, Add a sprint inside); New sprint tabs (main · inside); edit keeps sprints inside;
close and cancel of a main sprint with sprints inside; "CO1 · Week 3–4" wherever the running sprint shows; notices.

## Gate
Unit, DB, browser, checks, typecheck and lint before each commit; a final audit of every report line.
