# Updated By (replaces workspace presence) Implementation Plan

**Goal:** Workspaces and organizations stop showing presence and status, and show `Updated by NAME · time` from real work only.

**Architecture:** New `workspaces.last_update_at` and `last_update_by`. Database triggers on the event tables that already carry an actor (tasks, files, posted updates, GitHub pushes) stamp them; detail edits stamp them from the server actions. The client reads through a batched action with the same access rule the status reader had.

**Tech Stack:** Postgres triggers, Drizzle, Next server actions, React Query.

## Global Constraints

- Counts: edits to details, tasks, files, posted updates, GitHub pushes. Does not count: joins, join codes, visibility, system or moderator changes.
- An organization shows its own latest update; child workspace work does not roll up.
- Viewers who aren't members see the name only if the person's profile is public. Blocked or deleted people show no name.
- Time: under 1h `25m ago`, under 24h `2h ago`, under 7d `3d ago`, older `28 Oct` (year if a past year). Hover shows the exact date and time.
- People's presence stays. `status_*` columns stay until the release after this one.
- Local main only. No push, no live migration, until told.

## Review Focus

- An organization member's own assignment copy must not name them on the organization line.
- 500 assignment copies in one statement must not cause 500 row updates.
- A workspace with no actor events still shows a time, with no name.
- A viewer who can't read the workspace gets nothing back.
- The `live_workspace_event` trigger must not fire on a stamp.

## Tasks

- [x] **1. Database (`drizzle/0041_workspace_last_update.sql`, schema, `tests/db/workspace-last-update.test.ts`).** Failing test first: each event type stamps; excluded types, null actors and org copies don't; a repeat within a minute by the same person doesn't rewrite. Then migration with backfill.
- [x] **2. Detail edits (`src/lib/workspaces/last-update.ts`).** `markWorkspaceUpdated(executor, id, actorId)` called from `updateWorkspace`, cover image finalize and clear, stage, lifecycle and organization details.
- [x] **3. Read path and line.** `getWorkspaceLastUpdates` action, `formatLastUpdateTime` with unit tests, `WorkspaceLastUpdate` component in the header, cards and organization lists.
- [x] **4. Remove presence.** Badge, dot, status control, status actions, dead listener, their tests.
- [x] **5. Verify and commit.** `tsc`, eslint, unit, db and browser checks; commit locally.
