# Step 3 — Shared blocks

**Goal:** master plan step 3 (report §5.1–5.4, §5.7, §7.1, §10.2, §16.13, §17.1, §34.2, §37.6, §39.5; decisions 20, 22, 84, 108, 110; smaller bug 13).
**Tests:** `tests/unit/organization-shared-blocks.test.ts`.

| Item | Done as |
|---|---|
| Status words (5.7, 84, 108) | `ASSIGNMENT_STATE_LABELS` and `LATE_MARK` in `terms.ts`; the four copies in screens use it |
| Role words (39.5, 110) | `rolePlural`, `roleCount` in `role-words.ts` |
| Activity item (5.3) | `activity-rules.ts` (icon per kind, real time) and `components/ui/activity-item.tsx`, used by the workspace and organization activity lists; sprint rows use `started_at` and the join row the latest join (parity bugs 3 and 4) |
| Section (5.1) | `RailSection` already; long titles cut off since 1d |
| Tab bar (37.6, 34.2) | Rules already matched the table; a test now pins it. Smaller bug 13: admins start on `?tab=members` |
| Header (7.1, 17.1, 22) | Top bar button outlined on organization pages; breadcrumb without the slash; a chip only for Private or `Viewing as admin` (never the workspace's own people); details line says only what's running; counts and Follow hidden on non-public workspaces inside an organization; real tab titles for people who can open the page |

**My calls, to revisit in the tab steps:**
- **Row (5.2) and the empty-state pattern (5.4)** are built where their first screen needs them (step 4 Overview), not as unused components now. `EmptyState` and `RailSection` already cover the parts in use.
- **Organization context loaded once per page (10.2, 16.13)** moves with each tab step as it replaces its own `if`s with named slots; a one-shot refactor now would touch every tab before its step.
