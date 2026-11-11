# File versions: nothing is overwritten, Restore makes a version active

**Asked (2026-11-11):**
- Restore on an old version should make *that* version the active one, not add a copy.
- Nothing should ever overwrite a version.
- The CLI must not be affected.

## The concept

A file is an **append-only list of versions plus one "active" pointer**.

- **Saving always adds a new version** at the end. No path rewrites a version's content.
- **Restore moves the pointer.** It never adds or removes a version.
- **The active version is what everyone gets:** the app preview, downloads, the README, the CLI's `nb pull`, agents, and links to the file.
- **Every new version records which version it was based on**, so the history reads as a story even after going back.

### Example

| Step | Versions | Active | Panel shows |
|---|---|---|---|
| 3 saves | v1, v2, v3 | v3 | **v3 ACTIVE**, v2, v1 |
| Restore v1 | v1, v2, v3 | v1 | **v1 ACTIVE** (shifted to the top), then v3 · not active, v2 · not active |
| Save an edit | v1…v4 | v4 | **v4 ACTIVE** "based on v1", v3, v2, v1 |
| Restore v3 | v1…v4 | v3 | **v3 ACTIVE** at the top, v4, v2, v1 below it |

The panel lists the **active version first**, then the rest newest first. Versions newer than the active one are marked "not active". Every row except the active one has **Use this version**.

## Today, and what changes

- **Restore copies forward.** `restoreFileVersion` (`src/app/actions/files/versions.ts:344`) adds a new version with the old content. → **Change:** it moves the pointer.
- **"Apply to active version" overwrites.** The save dialog (`RevisionControlModal`, used by `TextViewer`, `FileView`, `FileActionsBar` and `FolderListView`) offers it, and `applyFileRevision`'s `active_revision` mode rewrites the active version's row and file. → **Change:** the option is removed and every save is a new version.
- **The old extension route can still ask to overwrite.** `/api/v1/extension/file` accepts `x-nb-revision-mode: active_revision`. → **Change:** the server treats it as a new version (old clients keep working; they just see the number go up).
- **Undo of a push or drop copies forward.** `files.restore` in `src/app/api/v1/undo/[id]/route.ts` and `undoDrop` in `src/lib/files/place-drop.ts` add a "back to version N" copy. → **Change:** they move the pointer back. The undone version stays in the list, not active.
- **The data is already half there.** New version numbers already come from history (`nextFileRevisionNumber`), and deleting the active version already picks the next active one. → Kept.

## Data

Migration **0081**: `file_versions.based_on_version int NULL`, plus a CHECK that it's ≥ 1.
- It's filled on every new version: the active version at the time of the save, or null for the first version.
- Restore doesn't write a version row. It updates the node's `current_version`, `s3_key`, `asset_id`, `size` and `mime_type` from the chosen version.
- It records an activity event, `version_activated {from: 3, to: 1}`, which the file's activity shows as "Ram made v1 active (was v3)" and realtime sends to open tabs.

## Rules that stay the same

- **Who can restore:** the same people as today (write access). Viewers can't, and nobody can for trashed files.
- **Locks:** the file lease, hand-in locks and organization rules apply as they do to saving.
- **Approved finals:** a task's approved version stays recorded. If you restore an older version, the task shows "Approved v3 · active v1" and doesn't silently re-approve.
- **Deleting a version:** same rules as today. Deleting the active version makes the newest remaining version active.

## The CLI and agents: no change, no release

What the CLI reads and sends stays the same:
- `manifest`, `doc view` and `me` still return the active version's number and hash.
- `files/place` already always makes a new version (`fast-push` never overwrites).
- Conflicts are still checked against the active version's number and hash.

So:
- After a restore, `nb pull` / `nb status` see "changed on the server" (`lib/sync/plan.mjs:24` compares with `!==` and the hash) and download the restored content.
- A push based on the version that was active before the restore gets the usual `VERSION_CONFLICT` and the conflict copy, so nobody's work is lost.
- `nb undo` calls the same server undo, which now moves the pointer; the CLI's output is unchanged.

**Proof:** the plan adds CLI tests against the fake server for a version that goes *down* (pull, status, conflict on push). They are test-only changes; no CLI code changes.

## Build steps

1. **Migration 0081 and the schema field.** DB test: a new version stores `based_on_version`.
2. **`applyFileRevision` always appends.** `active_revision` is mapped to `new_revision` server-side, and `based_on_version` is set. DB tests: no path changes an existing version's row; the old extension header makes a new version.
3. **`activateFileVersion`**, replacing `restoreFileVersion`: pointer move, lease, locks, event. DB tests: three versions, restore v1, then save → v4 based on v1; a push based on v3 after the restore gets `VERSION_CONFLICT`; trashed files and viewers are refused.
4. **Undo of push and drop** moves the pointer back. DB test: undo keeps the version, not active.
5. **UI:**
   - Remove the overwrite option from `RevisionControlModal`; the dialog only asks for an optional message.
   - Version panel: active version first, "not active" labels, "based on vN", the **Use this version** button, and a "Now using v1" toast with Undo.
   - The task file history drawer gets the same.
6. **CLI proof tests** (fake server, version going down), and a check that the API schema hasn't changed.
7. **Browser check** on the port-3100 copy: Files → README.md → three saves → restore v1 → content, badge, order → save → v4 "based on v1" → Undo.

**Deploy:** migration 0081 first, then the code (one push, with your go-ahead). No CLI release.

## Not doing

- Renumbering versions.
- Branches or merges.
- Diffs on Restore; Compare stays as it is.
- Changing how long versions are kept (plan limits).
