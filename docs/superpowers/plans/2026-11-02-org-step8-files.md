# Step 8 — Files

Report: 7.8, 16.4, 17.5, 18.6, 24.2, 24.4, 28.5, 37.5, 38.1 #6, 42.16. Decisions 8, 11, 12, 19, 20, 23, 42, 61. Gap 31.
Problems 50 and 51 shipped in 1b; this step builds the screen.

**Cut:** `OrgFilesPanel` boxes above the browser (Folder access list, storage line, From the organization, Sprint materials and Final files boxes).

## Server (tests first: `tests/db/organizations-files-step8.test.ts`, `tests/db/export-deadline.test.ts`)

1. **38.1 #6:** the profile's workspace image import offers an organization's files only under a Public folder (the visitor rule), never Admins-only or Members.
2. **Decision 61, 28.5:** an Admins-only folder (or one inside it) can't be a template; making a template folder Admins only clears the mark and the preview says so; Start from a template skips empty and Admins-only folders.
3. **Submissions page (37.5):** `readOrgSubmissionsAction(orgId)`: per assignment, each person or group with files, version, when, Late and status. Admins only.
4. **Child Final files (18.6):** `readChildFinalFilesAction(childId)`: group work handed in from this workspace, with its review state.
5. **Download all (28.5):** up to 2 GB; over it: "Too large for one download. Download by group or person."
6. **In-use warning (37.5):** usage returns names (`CO1`, `Lab 3`); the dialog says "Used by CO1 and Lab 3. They’ll lose this file."
7. **Permissions table:** `set_folder_access`, `download_all`, `empty_trash` leave `PENDING_ENFORCEMENT`.
8. **Code editor (24.2):** a member's save in an organization answers "Only admins can change CSE 3B’s files. Your changes stay on your computer."

## Screen

- Left panel: organization: All files, Task files, Sprint materials, Submissions (the type's word, admins), Recent, Starred, Trash. Workspace inside one: All files, Task files, From CSE 3B, Final files, Recent, Starred, Trash.
- Folder `⋯` → **Who can see this?** (Everyone in CSE 3B, Admins only, Public, with the consequence line and Use as template). Admins only.
- Storage leaves Files: a slim "Storage is 85% full · Manage" notice for admins only.
- Upload: each too-large file is named ("x is 14 MB. Files can be up to 10 MB."); the others still upload.
- Code editor button marked "Read only" for organization members, with the picker line.
- Empty states for an organization's files; Tasks' group work panel says the organization's name (gap 31).

**Moves to step 9:** Storage's Review (large files, old versions) lives in the Settings Storage section built there.
