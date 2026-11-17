# M9, the final audit: report and plan

> Plan register: M9 means `check:plan-ledger` with 0 remaining, every suite green, the E9 walkthrough repeated, and the
> review log marked complete. No new migrations are planned; each deploy goes out with the user's go-ahead.

## Where the ledger stands (2026-11-18)

- **195 rows open:** 137 todo, 53 tested-not-live, 5 built.
  - By milestone: M8 121, M3 30, M4 28, M9 9, M7 6, M5 1.
- **`check:plan-ledger` reports 60 problems.** 50 of them are rows marked live without a test named.
- **Every suite is green on the current site:** unit 3543, DB 1157, CLI 331.
  - The 29 Chromium browser failures from before M8 (review queue, desktop IDE, person card and others) are still open.

## What's left, in four kinds

### A. Bookkeeping (about 110 rows, no new code)

- **Live rows without a named test (50):**
  - Name the test file that proves each one. Most are M7's F11 rows and M8's H rows.
- **M8 rows that shipped but were never ticked (about 60):**
  - Decisions, the data model, routes, writers, merge and protection, history and merge requests: H1, H2, H5, H6, H10–H15, H19–H22.
  - For each: check it against the live site or a test, then tick it with its commit.
- **"Later" rows:** H17, and the merge request into a branch other than main (H13; decision 1 of H-3).
  - Mark these n/a, with the reason and the decision that deferred them.

### B. Real gaps to build (about 70 rows, in four deploys)

1. **Polish (0.8 #1, #3, #4, #5, #7, #8, #11):**
   - Empty states for every new list.
   - A one-time "New: branches" note.
   - Unsaved edits kept when switching branch.
   - Merge request comment drafts kept until sent.
   - Confirm dialogs that name the exact thing.
   - Skeletons instead of spinners, plus scroll kept per folder.
   - Keyboard: `/` searches, `b` opens branches, `?` lists the keys.
2. **Branches in depth (H8, H24, C14b):**
   - **The CLI on a branch:** `nb file history`, `use` and `diff`.
   - **What follows the branch:** the branch's README, the versions panel, search and activity.
   - **Notifications and merging:** saves on a branch notify only its watchers, batched per 15 minutes; a merge offers one Undo.
   - **README:** the README editor's Save to a new branch.
   - **Renames and deletions:** renaming a branch keeps CLI folders and GitHub on it; a folder whose branch was deleted says so.
   - **Old links:** to a deleted branch, they offer Restore or Go to main.
   - **Archived workspaces** make branches read-only.
3. **Journeys and limits (H23, H15, H2):**
   - **Stale branches:** "Stale" after 30 days, and one "Archive or keep?" note to the owner after 90.
   - **Updating:** Update from main is offered when a branch is more than 20 saves behind.
   - **From a task:** "Start work on #4" makes a branch for the task.
   - **Cleanup:** merged branches are deleted after 7 days.
   - **Offline:** branch switches work offline, and queued saves keep their branch.
   - **Phones and inbox:** the picker is a bottom sheet on phones, and the inbox gets a "My reviews" filter.
   - **Limits:** 10 branches per agent sign-in. Hand-in locks and the AI policy are checked per save and per merge. Assignment copies refuse branches.
4. **Scale and proof (H18, H25, H26, H27):**
   - **Speed tests:** a branch switch with 5,000 files under 1 s, opening a 200-file merge request under 2 s, merging 200 files under 5 s.
   - **End to end:** the agent run over 30 files.
   - **Caching:** branch trees cached by head.
   - **Audit:** the H27 journey check as tests.

### C. The walkthrough (E rows from M3 and M9)

- **Repeat E9 on CLI 2.5.0:** terminal, AI agent, student, teacher, team lead, solo developer and organization admin, timed against the E5 targets.
- **Turn the stable steps into automated journey tests** (E9 #1), so it repeats on every minor release.
- **The network cases I can do here:**
  - a throttled connection
  - a company proxy with its own certificates
  - a sign-in revoked mid-command
  - a 25 MB file
- **GitHub Codespaces:** the CLI in a cloud sandbox (needs a Codespace; I can run it if you allow one).

### D. Steps only you can do

1. A real **Windows** machine: install, sign in, push and pull, watch, agent setup (C6, E3).
2. A **first-time person's** walkthrough: someone who has never used NetworkBase (E9 #3).
3. A **screen-reader** pass: VoiceOver or Narrator, with `--plain` and the approval page (E7, F9).
4. **npm `next` tag** (two-factor), and creating **`networkbase/action`** (F6, F7).
5. **Homebrew, winget and Scoop:** create the tap and the manifests' repositories (C15 #3).

## Order I'd follow

1. **A: Bookkeeping.** One commit, no deploy. The ledger check drops from 60 problems to only the real gaps.
2. **B1 to B4:** four deploys, each with its tests and a live check, and each on your go-ahead.
3. **C: The walkthrough.** Findings go to `docs/superpowers/plans/<date>-walkthrough-findings.md`, and new rows land in the ledger.
4. **D:** your steps, whenever you have time. Then the review log is marked complete and `check:plan-ledger` reports 0.

## Risks

- **"Ticked without checking":** every tick in A names a test or a commit, and the ledger check enforces it.
- **B2 touches the editors:** unsaved edits, README, versions. Each change gets a browser test, and nothing that works today changes behaviour on main.
- **Speed tests can be noisy:** they run against the disposable database with fixed data, and a failure must repeat before it counts.
- **The member-settings concept stays parked**; it's yours to start.
