# M8 phase H-5 (GitHub branch mapping and cleanup) plan

> Native execution, test-first. This covers report Part H:
> - H6, GitHub branch to branch
> - H16, removing the old task sandbox
> - H21, the sandbox risk
>
> It builds on H-1 to H-4 and deploys on its own with the user's go-ahead.

**Goal:** fix the mixing problem, where pulling GitHub `feature-x` and then `main` lands both in the same workspace files. A GitHub branch syncs with the NetworkBase branch of the same name. The old, unused task sandbox is removed.

## Decisions (differences from the report's design)

1. **The mapping is automatic when Branches is on.**
   - The repository's default branch maps to `main`.
   - Any other GitHub branch maps to the NetworkBase branch with the same name.
   - Choosing the branch in Repository sync turns it on. There is no separate per-branch switch (the report's "turn on per branch, or for all"). **ponytail:** add the switch if people want some branches left unsynced.
   - With Branches off, nothing changes.
2. **Pull:**
   - A pull from GitHub `feature-x` writes NetworkBase `feature-x`, as one save "From GitHub owner/repo@sha" (kind `sync`).
   - If that branch doesn't exist, the pull creates it from main.
   - A pull from the default branch writes main as before. A protected main takes it only while "GitHub sync may update main" is on (H-4).
3. **Push:**
   - A push to GitHub `feature-x` sends NetworkBase `feature-x` when that branch exists, and main otherwise.
   - So "push main to a new GitHub branch and open a pull request" keeps working.
4. **The review records the local side** (`local: { branchId, name, headSaveId }`, or `create`). The run stops with "The branch changed after review. Compare again." if the branch moved, or if a branch to create appeared meanwhile.
5. **Repository sync says which side it's on:** "NetworkBase branch feature-x" or "NetworkBase main", plus "(new)" when a pull will create the branch.
6. **Not in this phase:**
   - **Pushing a NetworkBase merge to GitHub by itself** (the report's "merging pushes the merge result to GitHub main"). After a merge, main's new save shows in Repository sync as a change to push, with the same review as any push. **ponytail:** an automatic push needs a stored credential and a background run; add it when asked.
   - Linking merge requests with pull requests stays later (H17).
7. **The old sandbox:**
   - Production has 0 `workspace_git_deltas` rows and 0 nodes with `canonical_node_id` (checked 2026-11-17).
   - The following are removed:
     - `merge-sandbox.ts`
     - `POST /workspaces/:id/tasks/:taskId/merge`
     - the table and the column, by migration `0100`, which needs the user's OK in production
     - the code that only read the column: the task "deliverable" match, the review snapshot join, sprint file rows and `createFileNode`'s `canonicalNodeId`

## Tasks

1. **`compareSync` local side:** `localSideFor(ctx, direction, githubBranch, defaultBranch)`.
   - It builds local rows from the branch's files (`branchTree`) for a branch, and from `workspace_nodes` for main.
   - Branch files have no node ids.
2. **Runner:**
   - Pull into a branch: create it if needed, then one `writeBranch` with kind `sync`, then the baselines.
   - Push from a branch: the content comes from the branch's assets.
   - `validateReviewedLocalFiles` checks the branch head instead of the nodes.
3. **Repository sync UI:** the local side line.
4. **Sandbox removal:** code, route, schema, migration `0100`, and the readers.
5. **Tests:**
   - DB: pull feature-x creates and writes the branch and leaves main untouched; pull default writes main; push feature-x sends the branch's files; the branch moving after review stops the run.
   - Unit: the mapping.
   - Removal: no references left.

## Close

The gates are unit, DB, tsc, lint and browser tests. Then a review, a local commit, and a report. Deploy and `0100` only on the user's word, then a live check on ponytail, which is connected to GitHub.
