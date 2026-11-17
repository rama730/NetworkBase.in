# M8 phase H-2b (branches like GitHub) plan

> The user's review of H-2 on 2026-11-17: branches, changes and history should work like GitHub, as report H2 says. This replaces H-2 decision 1 (a branch page, with the explorer kept on main). It ships with H-3 in one deploy. Native execution, test-first on the server.

## What changes

1. **The branch picker, "main ▾", sits in the Files header where "GitHub needs access" was.**
   - GitHub moves into the header's ⋯ menu, on every screen size.
   - The picker has a search box and lists recent branches with "2 ahead, 3 behind" and their open merge request, plus **New branch** (name, from) and **View all branches**.
   - `b` opens it.
2. **Picking a branch switches the Files tab (report H2).** The address carries `?branch=`, which stays as you move between views.
   - **All files** shows the branch's tree, in the main panel and in the sidebar.
   - On that tree you can:
     - open a file: text, image and PDF previews
     - edit text, add a new file, upload (files and folders)
     - rename or move a file or folder, delete
     - download a file, or a folder as a zip
     - search names
   - Every change is a save on the branch (the branch writer, or a change set on the branch for uploads).
   - **History** follows the picker.
   - **Stays on main:**
     - Task files, Recent, Starred, Trash and Changes (report H2: task files are main-only)
     - the picker hides on those views, and the branch stays in the address for when you come back
3. **The "On branch x" bar** is shown on the branch's views. It says ahead and behind, and has:
   - **Compare with main** (the changes and their diffs)
   - **Update from main** (choose per conflicting file)
   - **Open merge request**, or **MR !3** when one is open
   - the branch's ⋯: rename, delete, zip
4. **The sidebar loses Branches.** The full list opens from the picker (`?filesView=branches`): filters, restore, rename, delete; picking a row switches to it. Changes, History and Merge requests stay in the sidebar.
5. **History, like GitHub's commit list:**
   - saves grouped by day
   - each with author picture, message, save number, files changed, +lines −lines, task and how it was made
   - a save's page lists each file with its +/−, then its diffs, Browse files, Download zip and Revert
   - line counts are worked out once per change and stored (`save_changes.lines_added/removed`, `saves.lines_added/removed`, in 0098)
   - stats are left blank for saves over 200 files and for binary files

## Server additions

- `branches.ts`:
  - `branchFolder(actor, branchId, folder)`: subfolders with counts, and files
  - `moveOnBranch(actor, branchId, from, to)` (a file, or every file under a folder)
  - `deleteOnBranch` for folders too
  - the branch zip takes `path`
  - `raw` serves images (not SVG) and PDFs inline for previews
- Uploads on a branch go through a change set on the branch (`startChangeSet { branchId }`, `upsertItems`, `putContent`, `finishChangeSet`, `applyChangeSet`), like the CLI.
- `saves.ts`: `fillLineStats(saveIds)`.

## Tests

- DB: folder listing, folder move and delete, line stats.
- Browser:
  - the picker switches All files
  - the bar
  - edit, upload and rename on a branch
  - History grouped by day with +/−
  - accessibility in light and dark, 1440 and 390 px

## Built (2026-11-17, local, ships with H-3)

- **Everything in "What changes", 1 to 5.**
- **Line counts:** each list request reads at most 150 files' worth to work them out (`fillLineStats` budget); the rest fill in on later loads. A save's page always works out its own.
- **On a branch, the header's ⋯ Search hides:** the explorer's "Go to file" searches the branch.
- **Tests:**
  - DB 2
  - browser: branches 10, history 8
  - the full Chromium suite
- **Already failing before this work:** 29 browser tests in other areas (review queue, desktop IDE, person card, sprints and others). They fail the same way on a clean copy of the H-3 commit without these changes. Follow-up.
