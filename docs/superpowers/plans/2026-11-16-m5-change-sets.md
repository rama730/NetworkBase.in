# M5 (Part G core: change sets) phase plan

> Native execution, test-first. Ledger: milestone M5 (294 rows: G, G1–G13, G15–G17, G19–G26 for phases G-1 to G-3; 0.8 #4, #5, #9, #10). G14 (`fs_*`, text index) and G18 (git) are M6.

**Goal:** an agent's multi-file job becomes one change set: captured locally while it works, reviewed in the app, applied all at once, undone with one click.

**Spec:** `docs/superpowers/plans/2026-11-11-cli-agents-next-round.md`, Part G.

## Global constraints (from the report)

- **Limits (G13):**
  - 2,000 items and 500 MB per change set; 25 MB per file
  - open change sets: 3 per agent sign-in per workspace, 10 per person
  - 1 GB of draft content per person per workspace
  - 50 applied change sets per agent a day
- **Small** = at most 20 files, no deletes, no finals, no docs. Everything else is big and needs the person's yes for agents.
- **Rate limits (G7):** items 120/min, content 60/min, apply and undo 10/min, per token.
- **Content:** the key is `<workspace_id>/.changes/<sha256>`; purpose `change_set_content`; deduplicated per workspace.
- **Apply:**
  - one transaction, nodes locked in node-id order, 30 s statement timeout
  - a repeated apply returns the stored result
- **Undo:**
  - refused (`UNDO_BLOCKED`) if any file moved on since the apply
  - `partial` undoes the rest
  - no time limit in the app; agent tokens keep 24 h
- **Rollout:** behind the `workspaces.change_sets_enabled` flag (G23), turned on first for the user's own workspaces.
- **Migration number:** 0091 (0090 went to the M4d sandbox; R1 says numbers follow apply order).

## Review focus (tested in the owning task)

1. A teammate saves a file between prepare and apply: the re-check rolls back, prepare runs once more, and a second change returns 409 (task 3).
2. An apply that fails halfway through the items writes nothing and the status returns to `ready` (task 3).
3. An undo after someone edited one of the files: `UNDO_BLOCKED` names that file; `partial` undoes the others (task 3).
4. Capture with a storm (300 events in 2 s, a `git checkout`): one rescan, not 300 uploads (task 5).
5. An agent with a "Read only" preset, or on a "Not allowed" assignment, can't start, add to or apply a change set (task 2).

## Phases and tasks

### G-1. Core (site + CLI 2.2.0)

**Task 1. Migration 0091 and schema.**
- Builds:
  - `change_sets` and `change_set_items` as in G4
  - `file_versions.change_set_id`
  - `workspaces.change_sets_enabled`
  - RLS on, browser roles revoked, `nb_app` granted (the 0080 pattern)
  - Drizzle schema, journal entry, SQL governance manifest
- Tests: `tests/db/change-sets-schema.test.ts` (constraints, the unique path per set, cascade on delete).

**Task 2. The domain module `src/lib/domain/change-sets.ts`.**
- Builds:
  - `startChangeSet`, `listChangeSets`, `getChangeSet`
  - `upsertItems` (returns `missingContent`), `dropItem`
  - `putInlineContent` (re-hash, store once, verified asset)
  - `finishChangeSet` (all content verified, secret scan, counts, the small/big decision)
  - `discardChangeSet`, `copyChangeSet`
  - permissions per the G13 table
  - path rules: NFC, Windows-reserved names refused (`BAD_PATH`)
  - the agent gate with change kind `changeset` and a token bound to the set's id and the hash of its items
  - organization locks and Pause agents
- Tests: `tests/db/change-sets-domain.test.ts` (every G5 transition including refused ones, every limit, the permission table, the secret hold, dedupe).

**Task 3. Apply and undo.**
- `prepareChangeSet` (the current version per item; until G-3, a changed base is a `conflict` of kind `edit`).
- `applyChangeSet` (G10 step 2; folders created, nodes locked in id order, versions written with `change_set_id`, deletes to Trash, renames).
- One undo row with the inverse `changeset.undo`, node events `change_set_applied`, and the activity with Part B labels.
- `undoChangeSet` (G11, with `partial`). The `/api/v1/undo/:id` route handles the `changeset.undo` kind.
- After commit: broadcast and notifications.
- Tests: `tests/db/change-sets-apply.test.ts`:
  - all or nothing with a failure forced mid-apply
  - a repeated apply returns the stored result
  - the lock order, with two concurrent applies
  - the teammate race
  - undo: blocked, partial, add, delete, rename
  - task attachments kept on rename

**Task 4. Routes 1–7, 9, 12, 13.**
- Under `src/app/api/v1/workspaces/[id]/change-sets` and `src/app/api/v1/change-sets/[cs]/…`.
- Each route has its `TOKEN_ROUTES` entry, the rate limits, `Idempotency-Key` on writes, and CSRF for cookie sessions.
- `api-versioning-contract` and `token-route-coverage` updated.
- Tests: `tests/db/change-sets-routes.test.ts` (each route's answers and errors, token scope, agent read-only refused).

**Task 5. CLI 2.2.0.**
- `lib/changes/capture.mjs`:
  - watch, ignore, settle, hash, classify (rename = a delete plus an add with the same hash within 10 s)
  - the storm guard, then a rescan
  - the journal `.networkbase/changes/<id>.json`, the upload queue (8, or 4 on Windows)
- Capture runs inside `nb mcp`, with auto-open titled from the session's task, and in `nb watch --change`.
- `nb change start|status|list|view|finish|apply|undo|discard|copy` with the `nb.change.*/1` JSON schemas.
- MCP tools `change_start`, `change_status`, `change_finish`, `change_apply`, `change_undo` and `change_discard`; the instructions switch to change sets only where the flag is on.
- G17: `nb push` uses a change set only when the push is bigger than one call allows.
- Tests: `packages/nb-cli/test/change-capture.test.mjs` (saves, rename, storm, crash then resume) and `change-commands.test.mjs` (commands, JSON, exit codes) against the fake server.

### G-2. Review (site)

**Task 6.**
- Route 8, the diff.
- The Changes view in the Files tab (`?tab=files&changes=<id>`):
  - the list and one set's page (G12)
  - file groups, filter, virtualised list
  - text, image and binary diffs
  - Apply / Discard / Undo / Copy as new draft
  - Apply only some files (a new set from the chosen paths)
  - Ask for changes (an agent note, D16)
  - the header link when something is ready
  - the version panel's "part of '…'"
  - 0.8 #9: times in the person's zone, with the exact time on hover
- Tests:
  - `tests/browser/change-sets-view.spec.ts` (light, dark, 1440 and 390 px, keyboard `j`/`k`, axe)
  - `tests/db/change-sets-diff.test.ts`

### G-3. Conflicts (site + CLI 2.2.1)

**Task 7.**
- `packages/nb-cli/lib/sync/merge3.mjs` (G9, shared with the server).
- Prepare merges cleanly changed bases (`merged` + the merged asset).
- Routes 10 (update) and 11 (resolve).
- The merge editor (base, theirs, result).
- `nb change update` and `nb change resolve`.
- The conflict kinds `deleted`, `moved`, `exists` and `folder_gone`.
- 0.8 #4 (unsaved app edits kept), #5 (comment drafts kept), #10 (notifications grouped per change set).
- Tests:
  - `packages/nb-cli/test/merge3.test.mjs` (property tests, line endings, text detection)
  - `tests/db/change-sets-merge.test.ts` (each conflict kind, two sets applied in either order)

### Close

- `benchmark` runs before and after against the G22 speed targets (50-file finish < 10 s, apply < 2 s, 2,000-file apply < 30 s).
- `ponytail-review`, then `review`.
- The gates.
- The ledger moves to `tested`.
- One go-ahead per phase: migration, push, deploy, Inngest re-sync, npm.
- A live check on the user's workspace (G24b normal-user journey).
- The parked member-settings concept reminder.
