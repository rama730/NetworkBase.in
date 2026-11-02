# Step T — Type profile, permissions table, limits

**Goal:** master plan step T (report §21.1–21.5, §39.2, §10.3; decisions 32, 33, 34, 109; gaps 1, 10, 11; C3, C5, C6; DB3).
**Tests first:** `tests/unit/organization-type-profile.test.ts` (profile, permissions contract, limits rules), `tests/db/organizations-type-profile.test.ts` (saved settings, fill, type change, limits).

## 1. One type profile (21.2, decision 32, gap 1, C3)

`src/lib/organizations/type-profile.ts`, client-safe and pure: `ORG_TYPE_PROFILES: Record<OrgType, OrgTypeProfile>` and `typeProfile(type)`.
Fields: `roleNames`, `finishedWork` ("Submissions" | "Final files"), `termDates`, `sprintPrefix`, `joinMode`, `visibility`, `membersPost`, `membersCreateChannels`, `generalNotify`, `reviewRequired`, `lateRule`, `storyPoints`, `starterFolders`, `showCompensation`, `planLabel`.

Replaces the type checks in: `config.ts` (role names), `creation.ts` (defaults), `settings.ts:121`, `chat-rules.ts:14,17`, `file-rules.ts:34`, `lifecycle.ts:902`, `FilesTabRoot.tsx:797`, `CreateSprintModal.tsx:338`, `Phase3TeamRoles.tsx:70`, `Phase5Review.tsx:368`. A unit test fails if `=== "education"` appears outside the profile.

## 2. Settings stop following the type (21.2, DB3)

- **On create:** every type-set value is saved in `org_settings` (review, late rule, story points, members create channels, #general notify). Role names are saved only where they differ from the type's, so a later type change can still rename them.
- **Existing organizations:** migration 0048 fills only the missing keys from their current type. Existing values win.
- **Change type:** owner only (`edit_identity`). It renames roles that still match the old type's names, and changes labels. Nothing else moves. The confirmation lists both.
- **Words:** term dates show for Education only; "Plan your term" becomes "Plan your sprints" elsewhere.

## 3. Permissions table is the real check (21.3, 39.2, decisions 33 and 109, gap 10, C6)

- New rows from 21.3 and 39.2 join `permissions.ts`.
- `orgManager(orgId, action)` in `org-members.ts` checks `orgGrant(role, action) === "yes"`. Every exported action there names its row.
- Child workspace actions in `organizations.ts` (archive, detach, request detach, visibility) go through `childGrant`, so it is used.
- **Contract test:** every exported action in `org-members.ts` and the child actions names a row that exists. Rows not yet enforced are listed with the tab step that moves them, so nothing is silently unchecked.
- Members can't invite, and no setting says otherwise (C6).

## 4. Limits (21.4, decision 34, gap 11, C5)

Each gets a check before anything starts, and a plain message. Admins see "Contact support to raise this"; members see "Ask an admin".

| Limit | Where |
|---|---|
| 200 workspaces per organization | workspace creation in an organization |
| 20 admins | Change role to admin |
| 20 teams per workspace | adding a team |
| 500 teams per assignment | assignment create |
| 500 documents | New doc in an organization |
| 1,000 invites a day | invite by email, with "412 left today" |
| 500 invites per paste (C5) | already checked; message stays |

**Moved, my call:** 10 seats per team (decision 45) is step 11, team storage 2 GB is step 9, and Download all 2 GB is step 8, where those features are built.
