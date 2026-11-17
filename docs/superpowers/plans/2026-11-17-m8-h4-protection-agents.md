# M8 phase H-4 (protection and agents) plan

> Native execution, test-first. This covers report Part H:
> - H5 (protecting main) and H7 (agents on branches)
> - the H14 protection route and H15 (protection rows)
> - the H24 protected-main situations
> - the H18 protection tests
>
> It builds on H-1 to H-3 and deploys on its own with the user's go-ahead.

**Goal:** an owner can protect main so that it changes only through merge requests, with approvals, checks and who may merge. Agents then work on their own branch and open a merge request for the person.

## Decisions (differences from the report's design)

1. **One guard in the database.** Every change to main is already recorded by 0096's triggers. A deferred trigger `saves_guard` on `saves` refuses a main save at commit when:
   - main's protection requires merge requests and the save isn't a `merge` or `squash` (or a `sync` while GitHub sync is allowed), or
   - "Agents work on branches" is on and an agent made the save.

   It raises `BRANCH_PROTECTED`, which the route error funnel and the Files actions turn into a 403 with the fix. No writer can forget it.
2. **Rules are a row per branch (`branch_protection`), and only main has them in this phase**, because merge requests target main only.
   - **When Branches is turned on**, the row is made with the H5 defaults: merge requests required when the workspace has more than one member, otherwise off. Approvals start at 1 when required and there's someone else to approve, otherwise 0. Agents on branches starts on; checks start off; anyone with write access may merge.
   - The migration makes the same row for workspaces that already have Branches on.
   - **ponytail:** a personal workspace that later gains a member keeps its saved rules; the owner turns protection on.
3. **"Agents work on branches" can't be turned off while the workspace has more than one member.** The PUT refuses it.
4. **Owners and admins override only by "Merge without approval".**
   - It skips approvals and checks, never conflicts.
   - It needs "Verify it's you" (the existing step-up) and is written to the security log.
   - A direct edit to a protected main has no override. An owner can turn the rule off, and that change is also logged.
5. **On a protected main, the app offers "Save to a new branch"** for the editor, Use this version and restoring from Trash. Revert does the same by itself (decision 6).
   - The branch is named `<username>/<what>` and gets a pre-filled merge request.
   - Uploads and drops onto main stop before any bytes move, with "main is protected: use a branch". The picker in the Files header makes one, and Upload there saves on the branch.
   - Move, rename, delete and new folder are refused by the database with the same message.
   - **ponytail:** one-click "upload to a new branch" from a drop on main when people ask.
6. **Revert on a protected main** (a save or a merge) makes the branch `revert/<save number>` with the inverse change, then opens a merge request.
7. **The CLI:**
   - **`nb push` on a protected main, no git:** asks "main is protected: push to branch `<user>/<date>` and open a merge request?". On yes it makes the branch, moves the folder onto it, pushes and opens the merge request. `--json` answers `NEEDS_INPUT`.
   - **With git in the folder:** the refusal says `git switch -c <name>`, then `nb push`. The CLI follows git and offers to make the NetworkBase branch.
   - **Agent sign-ins:** go straight to `agent/<task or date>` with no question.
8. **Agents' change sets:**
   - With the rule on, an agent's change set on main starts on `agent/<task number>-<slug>`, or `agent/<yyyy-mm-dd>-<slug>` with no task. The branch is reused while it's active.
   - Apply saves on that branch, then opens the merge request (or updates the open one) with the change set's "What I did" as the description.
   - Agents still can't approve, can't merge into a protected main, and can't change protection.
9. **New agent tools, in a `branches` pack that `networkbase_more_tools` loads** (the report said the core pack; a pack keeps the core list short): `branch_status`, `branch_create`, `merge_request_open`, `merge_request_view`, `merge_request_update` and `merge_request_merge`.
   - `merge_request_merge` works only for an unprotected main, and is always held for the person's yes.
   - All of them call the H-2/H-3 routes.
10. **The approval page's Full help line** adds: "In workspaces with Branches, it works on a branch and opens a merge request for your review."

## Tasks

1. **Migration `0099_branch_protection`:** the table, the `saves_guard` deferred trigger, rows for existing workspaces, RLS and grants.
   - Columns: `branch_id` (primary key), `require_merge_request`, `approvals` 0–5, `reapprove_on_new_saves`, `required_checks text[]`, `merge_by` (writers or admins), `agents_on_branches`, `allow_github_sync`, `updated_by`, `updated_at`.
   - Tests in `tests/db/branch-protection.test.ts`:
     - a direct write, a revert and a restore on a protected main are refused
     - a merge passes
     - a sync passes only when allowed
     - an agent's write is refused when agents work on branches
     - an unprotected main is unchanged
2. **Domain `src/lib/domain/branch-protection.ts`:**
   - `getProtection` and `setProtection`: owners and admins only, people only, step-up when turning protection off, security log entry.
   - `mergeGate(mr, actor)`: approvals (only reviews on the current head when re-approval is on), required checks passed on the head, `merge_by`, agents refused on a protected main.
   - `mergeMergeRequest` gains `override` (owners and admins, step-up, security log) and applies with the save kind `merge` or `squash`.
   - API codes: `APPROVAL_REQUIRED`, `CHECKS_FAILED`, `BRANCH_PROTECTED`.
   - Route `GET/PUT /workspaces/:id/branches/:b/protection`.
3. **Protected-main flows:**
   - `toNewBranch(actor, workspaceId, changes, title)` makes the branch, saves the changes and opens the merge request.
   - It's used by the editor save, uploads, Use this version, Trash restore and Revert when main refuses.
   - The Files client shows one **Save to a new branch?** dialog whenever an action returns `BRANCH_PROTECTED`.
4. **Agents:** `startChangeSet` sends agents to their branch. The apply on a branch opens or updates the merge request. Then the `branches` tool pack.
5. **CLI:** `nb push` on a protected main (decision 7), with fake-server routes and tests.
6. **App settings:** Settings → Files → History gets a **Protect main** card with the H5 rules. The merge request page shows what's missing ("Needs 1 approval", "Check build failed") and **Merge without approval** for owners.
7. **Docs and wording:** `/docs/files/branches` gets a "Protecting main" section, plus the approval page line.

## Close

The gates are unit, DB, tsc, lint and browser tests for branches, history and merge requests. Then the ponytail review and the correctness review, a local commit, and a report. Deploy only on the user's word, then a live check on ponytail.
