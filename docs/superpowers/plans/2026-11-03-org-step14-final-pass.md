# Step 14 — Everywhere else and the final pass

Report: 7.13, 16.11, 16.12, 30.3–30.5, 31.7, 32.2, 32.3, 32.6–32.8, 37.7, 37.8, 41.7, 45.6. Decisions 75, 77, 102, 103, 164, 172, 175. Smaller bug 8.

Survey first (what earlier steps already shipped, so nothing is built twice):
- Messages (30.3): viewers kept out of `#general`, `#general` can't be left, org admins open workspace channels on Mentions with a "joined" line, posting blocked while read-only, Browse workspaces. Gap: the 200-channel limit counts `#general`.
- Notices (30.4): `assignments.reminded` and `org.team_changed` exist; due dates in notices go through each reader's zone; announcement email limit counts the org's calendar day and tells the author; badge removal, team change requests, joins without a group are told. Gaps: "Lab 1 is open again" on Reopen, "Ms. Rao answered your question" on a class question reply.
- Search (32.2): org scope, members' own copy, people for admins, quick actions exist. Gaps: document results skip the draft and per-document visibility rules (a member can see a draft's name); viewers get assignments with counts; unlisted organizations show by name to non-members; the due date is formatted on the server with no zone.
- Person chip (31.7): exists. Gap: several shared organizations show only one, with no "+2".
- Share (37.7): only organizations and workspaces have the Share dialog. Gap: no org line "People without access will see the private page."
- Followers (37.8): the button is hidden for members. Gaps: the server lets a member follow; joining doesn't end a follow; suspended or deleting organizations can be followed.
- Pop-ups (32.3): five `window.prompt`/`window.confirm` left in organization screens (Members excuse/remove reason, assignment late publish, excuse, drop-missing, delete) plus the create wizard's switch.
- Sidebar (bug 8): one org at a time, each running the full Needs you list, which reads every document for members.
- Preview as member (45.6): not built.
- Phones (32.7): 375px checks exist for every org tab. Gap: no `axe` run on organization tabs.

## 14a — Search, sidebar, channel limit
- Document results go through `listWorkspaceDocsAction` ids, so drafts and hidden documents never appear, in org scope, inside a workspace, and globally.
- Viewers get no assignment results. Unlisted organizations appear only to their members. The due date is left to the subtitle without a weekday.
- Sidebar: organizations read in parallel; the required-document read runs only when an unread required document exists (one SQL check first).
- 0055: the 200-channel limit leaves out `#general`.
- Test: `tests/db/organizations-step14.test.ts` (draft doc hidden from a member's search, viewer sees no assignment, unlisted org hidden).

## 14b — Followers and notices
- `toggleWorkspaceFollowAction`: an organization's members, and suspended or deleting organizations, can't follow.
- 0055 trigger: joining an organization ends that person's follow, quietly, and fixes the count.
- Reopen tells people not done: "Lab 1 is open again". A reply in a class question tells the asker: "Ms. Rao answered your question".
- Chip: "CSE 3B +2" when several are shared.
- Share dialog: organizations that aren't public say "People without access will see the private page."
- Tests in the same file.

## 14c — Shared dialogs
- The five organization pop-ups become `ConfirmDialog` (a reason field where a prompt asked for text). The wizard's switch too. Failure keeps the typed reason.

## 14d — Preview as member (decision 175)
- Cookie `nb_member_preview` = organization id, set by `startMemberPreviewAction(orgId)` for its owner and admins only, cleared by `exitMemberPreviewAction()`.
- `getWorkspaceAccess*` and `readViewerOrgRole` read it: for that organization and its workspaces an owner or admin becomes an ordinary member, `writeBlocked: 'preview'`, so every server write refuses with "You’re previewing as a member. Exit preview to make changes."
- Header `⋯` gets "Preview as member"; the page shows `Previewing as a member · Nothing you do here is saved [Exit preview]`.
- Test: access under preview is member with writes blocked; a member can't start one.

## 14e — Checks and measures
- `axe` on the Overview, Tasks and Members tabs in `org-tabs.spec.ts`.
- `scripts/sql/org-measures.sql`: the 41.7 questions, emails waiting more than an hour (164) and failed hand-in uploads (172). Read only, run by hand.

Left for after the pilot, reported: "Frontend has no team lead", combined "2 reports to review" notices, full 16.12 scenario walks signed in (need a disposable Supabase and two browsers).
