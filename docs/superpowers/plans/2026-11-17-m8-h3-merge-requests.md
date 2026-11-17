# M8 phase H-3 (merge requests) plan

> Native execution, test-first. Report Part H: H4, H13 (into main), H14 merge-request routes, H15 (merge requests), the H23 review journeys, H24 merge-request situations, and 0.8 #10. It builds on H-1 (saves) and H-2 (branches). Deployed on its own with the user's go-ahead.

**Goal:** from a branch, open a merge request into main, review it, and merge or squash it. Reviewing covers comments, line comments, suggested edits and approve or request changes. This works from the app and from `nb merge-request`, with notifications and the linked task moving on merge.

## Decisions (differences from the report's design)

1. **Merge requests go into main only.**
   - Into another branch comes later; the report's H13 row stays todo.
2. **Merging is a Part G change set built from the branch's own files, applied with G10.** This is the same path as H-1's revert.
   - Each change's base is main at the branch's merge base, so main's moved files merge with G9 or come back as conflicts.
   - All or nothing, with one Undo. An agent's merge is held for the person's yes, exactly like an agent's Apply.
   - The save on main is `kind: merge` (with the branch head as its second parent) or `kind: squash`.
3. **Conflicts are settled on the branch with Update from main** (H-2's choices), not in a browser merge editor.
   - The merge request shows "Can't merge yet: N files changed on both".
   - **ponytail:** add a merge editor when people ask for line-level resolution.
4. **Comments live in `merge_request_comments`, not in the file comment anchors.**
   - A line comment stores path, line range and the save it was written on.
   - A suggested edit stores the replacement and the original lines.
   - **Apply suggestion** saves on the branch only if those lines are still the same; otherwise it's a conflict.
5. **The conversation comes from `merge_request_events`** (opened, ready, draft, closed, reopened, merged, branch updated), plus reviews, comments and saves.
6. **One notification kind, `merge_request`.** The title says the event, and repeats of the same event on the same merge request group together (0.8 #10).
7. **Checks are recorded and shown, but nothing blocks a merge on them.** Requiring checks is protection (H-4).
8. **Routes are `/workspaces/:id/merge-requests[/:n[/:op]]`**, where `n` is the per-workspace number (`!3`).

## Tasks

1. **Migration `0098_merge_requests`:**
   - tables: `merge_requests`, `merge_request_reviews`, `merge_request_comments`, `merge_request_checks`, `merge_request_events`
   - indexes: one open request per (source, target); numbers per workspace
   - RLS on, grants for `nb_app` and `service_role`
2. **Domain `src/lib/domain/merge-requests.ts`:**
   - `create` (pre-filled, refuses an empty branch (`MERGE_REQUEST_EMPTY`), one open per pair, at most 200 open), `list`, `get` (header, reviewers with "approved an earlier save", checks, saves, files, mergeable)
   - `update` (title, description, draft or ready, reviewers, close or reopen)
   - `review` (people only; not your own)
   - `comment` and `applySuggestion`
   - `postCheck`
   - `merge` (merge or squash; the task moves through the normal rules; the branch is marked merged)
   - deleting a branch closes its open requests; restoring it reopens them

   Tests: `tests/db/merge-requests.test.ts`.
3. **Routes and token rules**, plus API error codes:
   - `MERGE_REQUEST_EMPTY`
   - `MERGE_REQUEST_EXISTS`
   - `MERGE_REQUEST_LIMIT`
   - `MERGE_REQUEST_CLOSED`
   - `DRAFT`
   - `SELF_REVIEW`
4. **CLI:** `nb merge-request create|list|view|review|comment|merge|close|reopen|ready` (alias `nb mr`), with fake-server tests.
5. **App:**
   - Files tab → **Merge requests** (list and filters)
   - the merge request page:
     - a header with the merge buttons
     - Conversation, Saves, and Files changed (diffs, line comments, suggestions, Apply)
   - **Open merge request** on the branch page
   - browser tests

## Close

Review and security check; gates; benchmark (open a 200-file merge request; merge); ledger; deploy with the go-ahead (0098); live check on ponytail.

## Built (2026-11-17, local, not pushed)

- **0098 `merge_requests`:**
  - the five tables
  - `pending_change_set_id` and `pending_head_save_id`: an agent's held merge keeps its change set for the person's yes
- **Domain `src/lib/domain/merge-requests.ts`:**
  - create, list, get, update, review, comment, apply suggestion, post check, merge
  - deleting a branch closes its open requests; restoring it reopens them
  - each branch shows its open merge request ("MR !3")
- **Merge safety:**
  - A held merge is reused only by the person whose merge was held.
  - Saves that reach the branch while it merges leave the branch open (`branchMoved`) for another request.
- **Routes:**
  - `/workspaces/:id/merge-requests` (GET, POST)
  - `/:n` (GET, PATCH)
  - `/:n/{reviews,comments,suggestions,checks,merge}`
  - token rules
  - 6 error codes
- **CLI:** `nb merge-request create|list|view|review|comment|apply|merge|close|reopen|ready` (`nb mr …`). Without a number it uses the folder's branch's open request.
- **App:**
  - Files tab → Merge requests (Open, Waiting on me, Merged, Closed)
  - the page: reviewers with "an earlier save", checks, Conversation with Approve and Request changes, Saves, and Files changed (diff, line comments, suggested edits, Apply suggestion)
  - Merge or Squash and merge, Revert merge, and "Can't merge yet" pointing to the branch
  - branch page: Open merge request (title, description, Draft) or "MR !3"
  - `/docs/files/branches#merge-requests`
- **Tests:**
  - DB 7
  - CLI 3
  - browser 9 (light and dark, 1440 and 390 px, no accessibility violations)
- **Speed (local DB):** a 200-file merge request opens in 16 ms, reads in 6 ms and merges in 691 ms.
- **Not in H-3 (still todo):**
  - agents opening merge requests by default (H-4)
  - protection (H-4)
  - merging into another branch
  - a browser merge editor
  - "My reviews" across workspaces
  - per-branch watcher notices
