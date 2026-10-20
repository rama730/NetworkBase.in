# Project task completion review

Project settings → Lifecycle & Workflow contains **Require review before completing tasks**.
It defaults to off for existing and new projects. Owners and co-leaders (admin members)
can change it. Ordinary members and viewers cannot change the policy or approve reviews.

| Action | Review off | Review on |
| --- | --- | --- |
| Mark an active task done | Complete immediately | Submit for review |
| Approve a pending review | Lead completes the submitted work | Same |
| Request changes | Lead supplies a reason; return to In progress | Same |
| Change policy | Affects future completion attempts | Same |

Existing pending reviews remain actionable after the setting is switched off. Enabling
review never reopens completed work. A pending task cannot bypass review through a generic
status move, drag, reorder, or another Done request. Members move their own or unassigned
tasks; leads can move any task. Subtasks stay independently editable and do not complete a parent.
Self-review by a project lead follows the existing lead authority; there is no new self-review restriction.

The task drawer and extension offer explicit approval, requested changes and resubmission.
Pending work has an **In review** label without completed-title treatment. The board's
**In review** filter is paginated on the server. Completion totals, sprint closeout,
workspace outstanding work and due-date calculations exclude pending reviews from completion.

All completion writers use the shared transaction service, including task creation with
an initial Done selection, drawer controls, board moves, extension updates and explicit
GitHub closing directives after a direct push. Opening a pull request or pulling files
does not complete a task. Server outcomes remain authoritative if policy changes during an action.

Approval compares a SHA-256 snapshot of the submitted title, description, subtasks, links,
owned task files and active file revisions (including canonical file targets). Changed work
requires explicit resubmission. Project/task/file locks serialize policy changes and approvals.
Task versions reject stale review decisions. Approval stamps reviewed linked deliverables;
it does not publish, copy, transfer or replace files. Direct completion does not approve files.

Task events record submissions, decisions, reasons and actors. Setting changes have a separate
versioned project audit table. New submissions and completions have separate timestamps.
Legacy dates are left unknown; legacy pending work must be resubmitted before approval.

## Delivery

Apply `drizzle/0233_task_completion_policy.sql` through the normal migration runner before
running the updated app. The migration is append-only and preserves existing review outcomes.
Migration 0233 was applied to the live database on 2026-10-20 after explicit authorization.
The deployment preserved existing project/task data and left review off for all 15 existing projects.
Migration 0232 is unrelated and was left pending. The scoped deployment report is
`artifacts/task-completion-policy-live-migration.json`.

The companion extension is version **1.3.0**. The release VSIX is in the extension workspace.
Code checks cover shared transition behavior, settings permissions/versioning, stale approvals,
snapshot changes, review filtering, task presentation, and extension sidebar/editor/evidence flows.
Browser and live IDE verification are intentionally excluded.
