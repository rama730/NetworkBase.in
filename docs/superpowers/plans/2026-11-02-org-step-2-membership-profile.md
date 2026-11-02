# Step 2 — Membership and profile

**Goal:** master plan step 2 (report §4, §10.1, §16.9, §16.10, §26.9–26.11, §31.3, §36.4, §36.7, §38; decisions 1, 2, 3, 4, 13, 19, 48, 71, 97, 105, 107; DB2, DB5).
**Tests first:** `tests/db/organizations-membership-credit.test.ts` (data and who sees what), `tests/unit/organization-profile-rules.test.ts` (pure rules).
**Migration 0049:** `profile_contributions.end_reason` (left, removed, term_ended, org_deleted), `ended_by`, `end_note`, `nudge_dismissed_at`; `workspace_members.profile_order`.

## A. How a membership ends, and who sees the entry (commit 1)

| Rule | Where |
|---|---|
| Leaving records `left`; removal records `removed`, who did it and the written reason | `endProfileWorkspaceContributionMembership`, from `removeWorkspaceMemberInternal` (`removeFromOrg`, leave) |
| Removal withdraws verification, with "Removed from CSE 3B" as the reason | same |
| Removed entries are never public, for organizations and workspaces inside one; the person still sees theirs | public query in `collaboration.ts` |
| Rejoining clears the ending; a removed person's words come back as an unpublished draft (decision 3) | `upsertProfileWorkspaceContributionFromMembership` |
| A private organization's entry shows only to the person and its members (decision 105) | public query takes the viewer |
| Role label: organization role name · title; "Contributor" only when nothing is known (4.4) | `contribution-position.ts` |
| Old ended entries stay null and read as "left" (41.4) | read rule |

## B. Profile (commit 2)

- The chip row goes. A right-column **Organizations** section (after Collaboration preferences, before Links): current members only, the person's chosen order, and only organizations shown on the profile. Your own view adds the pencil and Join with code; others see nothing when it's empty.
- **Manage organizations** dialog: Show switch (the existing `show_on_profile`), Move up and Move down, saving at once.
- Contributions are split into Organizations (with nested workspaces) and Workspaces. Your own view adds "Not on your profile yet" (drafts) and "Private to you" (removed).
- The Workspaces section holds workspaces only (31.3).

## C. Private page states and leaving (commit 3)

- 26.9: invited, waiting, declined, left, removed, blocked and ended each get their own line on the private page and on a public About.
- 26.10: the Leave dialog lists what happens (teams left, open assignments removed, submitted ones kept, the profile entry stays as Left); leads see their workspaces to transfer first.

## D. Editor (commit 4)

- Left list grouped as the profile, with a status per row (Published, Draft, Hidden, Left, Completed, Private).
- Removed entries are read only, "Private to you", with Delete; they can't be published (server refuses too).
- Write-up nudges (38.6) on your own profile and in the editor, once each, cleared on publish or dismiss (DB5).
- Work record saves with the rest, not at once (38.1 #3).
- Locked facts say "Set by CSE 3B" with an Ask an admin link.

**Moved, my call:** the Former filter screen is step 11 (36.4); this step stores what it needs (who ended it, why).
