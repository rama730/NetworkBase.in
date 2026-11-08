# Organization workflow: verified audit and complete plan

## Context

An outside audit ("Master Architecture & Optimization Audit: Organization Sector") lists 73 findings in 10 areas, a migration `0085_optimize_organization_indexes.sql`, and a 1M-user infrastructure design. Its file paths are invented (42 of 43 cited files don't exist) and most of its tables don't exist (`organization_members`, `org_units`, `org_invites`, `org_audit_logs`, `feed_posts`, `handle_reservations`…). Many function names are real. The user wants every finding checked, every real problem fixed with the smallest correct change (Ponytail), better alternatives where the report's fix is heavy, and every issue the report missed — so the organization workflow is correct, fast and consistent for owner, admin, member, viewer and visitor.

This plan replaces the report. Every row below was checked against the real code (file:line). Verdicts: **C** confirmed · **C+** confirmed, worse than described · **P** partly true · **X** not real (code already handles it) · **F** already fixed.

Real code map: actions `src/app/actions/{organizations,org-members,org-lifecycle,org-profile,org-dashboard,org-workspace,org-updates,org-chat,org-docs,org-files,assignments,trust,moderation-org}.ts`; rules `src/lib/organizations/*.ts`; screens `src/components/organizations/*.tsx`, shell `src/components/workspaces/dashboard/WorkspaceLayout.tsx`; route `src/app/(site)/(main)/org/[slug]/page.tsx`; schema `src/lib/db/schema/index.ts`; migrations `drizzle/` (latest `0066`). Organizations are `workspaces` rows; child workspaces have a parent; members are `workspace_members`.

Reuse, don't rebuild: `consumeRateLimit` (`organizations.ts:75`), `resolveDestructiveStepUp` (`src/lib/security/destructive-step-up.ts`), `accountOrgLimit` / `AccountOrgLimitError` (`members.ts`), `orgLimitBlock`, `ORG_LIMITS` (`config.ts`), `revalidateOrg`, `leadsOf`, `notifyJoined`, `createOrgEmailInvites`, `identity.withIdentity`, the `org_join_blocks` trigger (`drizzle/0001_foundation.sql:76-92`), shared UI from the design work (`org-ui.tsx`, `ui/notice.tsx`, `.nb-*` classes, `display.ts`).

---

## Part A — The report's 73 findings, verified

### A1. Creation and onboarding (1.1–1.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 1.1 | X | `create-wizard/phases/Phase1SourceSelection.tsx:434-437` | Starter doc off for orgs on purpose (report §34.5) | None |
| 1.2 | P | `src/lib/workspaces/server/lifecycle.ts:1170-1185` | Invite failures already become a notice; real risk is post-commit work inside the insert retry loop | See N1 |
| 1.3 | P | `organizations.ts:158-176`, `join.ts:208-216` | 350 ms debounce exists; up to 15 queries in 5 rounds when taken; no rate limit | `consumeRateLimit('org:handle-check:'+userId, 60, 60)`; check the 4 suggestions in one `inArray` query. No Bloom filter |
| 1.4 | P | `org-dashboard.ts:631-637`, `OrgOverviewParts.tsx:224,259` | Saved server-side; cached dashboard still holds `welcome`, so it flashes back on remount | `setQueryData(['org-dashboard',orgId])` to null `welcome`; drop local state |
| 1.5 | P | `CreateWorkspaceRouteClient.tsx:110` | "Go to organization" goes to `/workspaces/<id>`, which renders the shell and then redirects | `router.replace('/org/'+handle)` |
| 1.6 | X | `organizations.ts:239-243`, `type-profile.ts:71-75` | Default names follow the new type; custom names stay | None |
| 1.7 | X (gap) | `schema:767`, `lifecycle.ts:115-125,174-196` | Hard-deleted after 30 days frees the handle; but purge skips an org forever while storage is pending | Alert/retry on purges stuck past 7 days |

### A2. Invites and joining (2.1–2.10)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 2.1 | P | `members.ts:24-44,70-101`; trigger `0006:627-631` | Trigger stops blocked joins, but `acceptOrgInvite` and `createOrgEmailInvites` don't check; trigger error 42501 shows as a crash | Check `orgJoinBlocks` in `acceptOrgInvite` → "blocked" result; skip blocked addresses when inviting |
| 2.2 | X | `org-members.ts:273-296` | Trigger refuses; one blocked applicant would roll back "Approve all" | Add `NOT EXISTS org_join_blocks` to the pending select (`:278`) |
| 2.3 | C+ | `org-members.ts:352,438-445`, `members.ts:85`, `lifecycle.ts:328-334` | 20-admin cap only checked on role change; admin invites, accept, creation co-admins, duplicate never check | Count admins under the row lock in `acceptOrgInvite`; count admins + open admin invites in `inviteByEmailAction`; same in creation/duplicate |
| 2.4 | C | `members.ts:91-95`, `collaborator-lifecycle.ts:262` | Full team on the invite rolls back the whole org join | Check seats first; if full, join the org without the team and tell the lead |
| 2.5 | P | `organizations.ts:380`, `OrgHeaderParts.tsx:77` | `joinPublicOrgAction` doesn't catch `AccountOrgLimitError` | `.catch(limitOnly)` → friendly message |
| 2.6 | X (gap) | `collaborator-lifecycle.ts:239-249`, `join.ts:146-148,178` | No overwrite; but the request lookup can rewrite a role-specific application | Add `isNull(roleApplications.roleId)` |
| 2.7 | X | `org-members.ts:53-58`, `settings.ts:50-69` | Zone is the org's stored, validated zone | None |
| 2.8 | C | `org-members.ts:374-387` | No resend cooldown; resends skip the daily cap | `consumeRateLimit('org:invite-resend:'+id, 1, 60)` |
| 2.9 | C | `org-ui.tsx:128-136` | Decline waits 5 s client-side; tab close loses it | Call the server at once; no Undo (delete is hard) |
| 2.10 | C | `members.ts:191-200`, `join.ts:137` | 50-org count can race across two orgs | `pg_advisory_xact_lock(hashtext('org-limit:'||userId))` first line of `accountOrgLimit` |

### A3. Roles, succession, security (3.1–3.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 3.1 | C | `org-members.ts:452`, `collaborator-lifecycle.ts:403-421`, `members.ts:144`, `org-members.ts:257-258,486` | Role changes, child removals and moves record the owner/lead as actor | `realActorId` on `changeWorkspaceMemberRoleInternal` and moves; events use it |
| 3.2 | C | `org-lifecycle.ts:68-80`, `OrgDangerZone.tsx:256` | Delete needs only owner + handle (30-day restore softens it) | `resolveDestructiveStepUp`; `STEP_UP_REQUIRED`; wrap in `identity.withIdentity` |
| 3.3 | C | `org-lifecycle.ts:196`, `account.ts:140` | Takeover and transfer accept a password when an authenticator exists | `resolveDestructiveStepUp` for both |
| 3.4 | C | `org-members.ts:374-395`, `OrgMembersTab.tsx:218-219` | Admins can cancel/resend admin invites | Non-owners: `ne(role,'admin')` in both WHEREs; hide buttons |
| 3.5 | C | `org-members.ts:242,258,713-720`, `members.ts:91-94`, `OrgInvitePanel.tsx:129-142` | Viewers become workspace members (breaks "viewers can't be on a workspace") | Skip/refuse viewers in add, move, invite-with-workspace, accept |
| 3.6 | P | `takeover-rules.ts:11-14`, `org-lifecycle.ts:140` | Null activity falls back to migration date, not join date | `coalesce(m.last_active_here_at, m.joined_at)` |
| 3.7 | C | `takeover-rules.ts:39`, `lifecycle.ts:394-395` | Departed asker's request blocks every other admin forever | Ignore the request unless asker is still admin; clear it on leave/remove/demote |

### A1–A3 new findings (N1–N38)

| id | Sev | Location | Problem | Fix |
|---|---|---|---|---|
| N1 | P1 | `workspaces/server/lifecycle.ts:1059-1236` | Post-commit work inside the insert retry: errors return failure though the org exists; retry says "@handle taken" by own org; can duplicate inserts | Leave the loop when the tx returns; follow-up work in its own try that only adds notices |
| N2 | P1 | `onboarding.ts:318-327`, `join.ts:196-205` | One failing invite at sign-up skips all others and the join code | try/catch per invite; code join in its own try |
| N3 | P2 | `onboarding.ts:320-322` | Sign-up joins/requests send no notifications | Move `afterJoin` (`organizations.ts:392`) into lib; call it |
| N4 | P1 | `takeover-rules.ts:38-40`, `lifecycle.ts:387-399` | A takeover request stays "ready" forever, even after the owner returns | Re-check `ownerAway` at takeover and expire requests after 14 days |
| N5 | P1 | `org-members.ts:53-58`, `members.ts:36-37` | Re-paste and resend bypass the 1,000/day cap | Set `createdAt` on upsert-update and resend; plus 2.8 cooldown |
| N6 | P2 | `members.ts:70-115`, `lifecycle.ts:78-125` | Invites to archived/suspended/deleting orgs stay acceptable | Status filters in `openInvitesFor` and `acceptOrgInvite`; cancel invites on archive/delete |
| N7 | P2 | `lifecycle.ts:328-334` | Duplicate org's copied admins never notified | Use `createOrgEmailInvites` |
| N8 | P2 | `org-workspace.ts:150-156`, `org-members.ts:113` | Cross-org Requests list ignores `review_hidden_by_block`; server approve/decline too | Same condition in both reads and in approve/decline |
| N9 | P2 | `OrgMembersTab.tsx:354,372`, `OrgRequestsSection.tsx:94` | "All approved" toast when 0 approved (50-org limit) | Toast from result: "N approved · M stay waiting" |
| N10 | P3 | `org-members.ts:280-282` | "Full" counts requests that will be skipped | Count only addable ones |
| N11 | P2 | `org-members.ts:285-293` | Approve-all runs thousands of sequential statements under the org lock | One grouped limit count, then loop |
| N12 | P3 | `org-members.ts:294` | Revalidation inside the transaction | After commit |
| N13 | P3 | `organizations.ts:373-389`, `join.ts:168-172` | Joining by page/code leaves the person's open invite listed | Delete that address's invite in the join tx |
| N14 | P3 | `org-members.ts:715-721` | "Role is full" race crashes the page | try/catch as at `:250-262` |
| N15 | P3 | `org-members.ts:713-729` | Add-to-workspace notifies people not added; toast "Added" with 0 | Notify inserted only; return skipped count |
| N16 | P3 | `org-members.ts:430-471` | Per-person lead query; wrong `changed` count | `leadsOf`; real count |
| N17 | P3 | `org-members.ts:389-395` | Cancel says success when nothing deleted | Check rows deleted |
| N18 | P2 | `org-members.ts:89-197,816-837` | Members open: duplicate permission/invite-panel reads, 4 sequential queries; `org_email_invites` grows unindexed | Compute once; index `(org_id, created_at)`; purge accepted invites |
| N19 | P2 | `organizations.ts:80-118` | `/join/CODE` = 5 sequential round trips | One SQL with subqueries |
| N20 | P3 | `OrgInvitePanel.tsx:97` | Email preview refetches each Title keystroke | Debounce title |
| N21 | P3 | `OrgInvitePanel.tsx:36,78`, `OrgMembersTab.tsx:99-104` | Panel changes don't refresh Members invite list/code | One shared query |
| N22 | P3 | `PrivateOrgHeader.tsx:17,24-30` | After Decline "You're invited" stays | `useInviteAnswer(() => router.refresh())` |
| N23 | P3 | `workspaces/server/lifecycle.ts:607-612` | Owned-org limit outside tx; create never checks 50-membership | `accountOrgLimit(tx,…,'own'/'join')` in tx |
| N24 | P3 | `org-lifecycle.ts:106-110` | Five duplicates queued at once all succeed | Re-check in `duplicateOrg` tx |
| N25 | P3 | `workspaces/server/lifecycle.ts:810` | Personal workspace can take an org's held old handle | Check `org_handle_holds` always |
| N26 | P3 | `useCreateWorkspaceWizard.ts:653,657,1001` | Toasts say "workspace" for organizations | Noun by `data.organization` |
| N27 | P2 | `trust.ts:163-184,199-221` | Verify checks unthrottled (outside fetches); parent ask re-notifies every click | `consumeRateLimit('org:verify:'+orgId,5,300)`; dedupe ask per day |
| N28 | P3 | `trust.ts:33-43` | Verification runs on orgs scheduled for deletion | Add `deletionScheduledAt` check |
| N29 | P3 | `org-profile.ts:28-71` | Bulk verify re-notifies verified people; admins can verify owner/admins | `isNull(verifiedAt)`; rank rule |
| N30 | P3 | `org-members.ts:413`, `organizations.ts:141,152` | Revalidates `/workspaces/...` instead of `/org/...` | `revalidateOrg` |
| N31 | P3 | `organizations.ts:316-329` | New-code retry can rotate twice and notify twice | Only the update in try |
| N32 | P3 | `members.ts:29-41`, `org-members.ts:383` | Invite email compared case-sensitively with profile email | `lower(profiles.email)` |
| N33 | P3 | `0052`, `org_member_away.user_id`, `org_verification_codes.user_id` | FK columns without index → profile delete scans | Three indexes (in the migration, Part D) |
| N34 | P2 | `org-lifecycle.ts:155-174` | No check the asker is still active | Covered by 3.7/N4 |
| N35 | P3 | `org-members.ts:160-162,821` | Two child-workspace queries per Members open | Reuse one |
| N36 | P3 | `org-members.ts:298-306` | Approval doesn't tell other admins who joined | `notifyJoined` |
| N37 | P2 | `OrgHeaderParts.tsx:59-65`, `JoinOrgButton.tsx:23-30`, `org-ui.tsx:119-126` | Thrown action errors crash the org page | Fix throwing actions; `.catch` → toast in the three helpers |
| N38 | P1 | `members.ts:133-148` | Leaving/removal doesn't clear the person's takeover request | Same as 3.7 |

`WDC` = `src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx`; `route` = `src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx`.

### A4. Navigation and shell (4.1–4.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 4.1 | P | `organizations/detail.ts:245-258`, `route:141-145` | Main lookup accepts id; outsider fallbacks `readOrgCard`/`isOrgOnlyWorkspace` match slug only → 404 by id | `isLooseUuid(slug) ? or(slug,id) : slug` in both |
| 4.2 | F | `route:136-140`, `resolveHeldOrgHandle` | Old handles already redirect (307) | Switch to `permanentRedirect` |
| 4.3 | C | `PrivateOrgHeader.tsx:33` | Sign in drops the return path | `/login?redirect=<pathname>` (as `OrgHeaderParts.tsx:57`) |
| 4.4 | P | `workspaces/[slug]/loading.tsx:15-50` vs `WorkspaceLayout.tsx:267,331,476` | Skeleton sizes differ (44 vs 64 avatar, max-width box, h-10 tabs, 7 vs 10 tabs, padding); then a second skeleton | Mirror `WorkspaceLayout` classes; body = `DashboardSkeleton` |
| 4.5 | C+ | `WDC:651-668,694-703`, `route:184-186` | Landing tab push → clean-up replace = 2 server round trips; every push re-runs server reads the client discards | Drop `tab` for landing; `window.history.pushState` (as `FilesTabRoot`, `usePanes`) |
| 4.6 | P | `WDC:705-712` | Adds `doc=readme` when absent → extra navigation and document read (no loop) | Normalize only a present slug |
| 4.7 | P | `WorkspaceLayout.tsx:239-250,489` | Roving tabindex exists; with no/hidden active tab no tab is focusable | First visible tab gets `tabIndex=0` then |

### A5. Overview and live updates (5.1–5.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 5.1 | C | `OrgOverviewParts.tsx:235-240`, `drizzle/0053`, `0044` | Overview never hears join requests or submissions (they go to personal topics) | Listen on `userTopic(viewerId)` for `org.requests.changed` + `notification.changed` (`useReloadOnNotice`, `ReviewQueueParts.tsx:31`). No new channel |
| 5.2 | P | `OrgOverviewParts.tsx:237`, `OrgWorkspacesTab.tsx:116` | Fixed 2 s wait, no jitter | `2000 + random*3000`; and N42 removes the main trigger |
| 5.3 | X | `org-dashboard.ts:661-667` | Empty arrays guarded; Drizzle `inArray([])` = false | None |
| 5.4 | P | `needs-you.ts:218`, `dashboard-rules.ts:90-94`, `member-rules.ts:13,94` | Same 14 days, different populations (role, behind, deleted accounts) | One population: role member, `inactive && !behind`, not deleted; links add `&role=member` |
| 5.5 | C | `org-members.ts:106,108`, `needs-you.ts:224` | Group copies live in child workspaces → never counted behind | Find copies via master (`m.workspace_id = orgId`); join team members on copy ids |
| 5.6 | P | `WDC:1062-1069` | Badges reread on tab switch, never live | Same listener as 5.1 → `readBadges()` |
| 5.7 | P (design) | `settings-policies.ts:368`, `WDC:1183` | Members tab is admin-only by design; members get a People link that bounces | Decision D-A below; at minimum link People only for admins |

### A6. Child workspaces (6.1–6.8)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 6.1 | P | `organizations.ts:664-667`, `org-dashboard.ts:478` | Admins can't replace a lead who left the org; tab shows "lead left" with no action | Allow when the lead isn't in the org (`leadInOrg`) |
| 6.2 | X | `child-units.ts:77-86,164-179` | Counters correct | None |
| 6.3 | X | `child-units.ts:193-194` | Guarded | None |
| 6.4 | C | `child-units.ts:62-70`, `tasks.team_name` | Team rename leaves `tasks.team_name` → moves stop carrying team tasks | Same tx: `UPDATE tasks SET team_name=new WHERE workspace_id AND team_name=old` |
| 6.5 | X | `organizations.ts:716-718`, `children.ts:82-97` | Only parentless workspaces move in | None (see N48) |
| 6.6 | P | `organizations.ts:716-774` | Move-in skips: archived source, archived/suspended/deleting org, 200-workspace limit, 2 GB team storage | `childCreationBlock`, `orgLimitBlock('workspaces')`, archived refuse, bytes vs `teamStorageBytes` |
| 6.7 | P | `children.ts:85-88,136-147` | Visibility capped; public repo stays linked until next push | Run `orgRepositoryBlock` (connect mode) on move-in |
| 6.8 | X | `organizations.ts:538,718`, `children.ts:21` | One level only; no cycles | None |

### A7. Updates, chat, moderation (7.1–7.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 7.1 | P | `UpdatesTab.tsx:629`, `UpdateDetailPanel.tsx:50,212,226` | Cards fine; detail panel uses org id → comments/likes on shared posts fail | `projectId = fromProject ? update.projectId : projectId` |
| 7.2 | C | `drizzle/0055:9-18`, `0014:759` | Viewers can create channels, self-join #general and post | Migration: org viewer ≠ member in `chat_create_channel`/`chat_join_channel` |
| 7.3 | C | `0014:1467-1475`, `org-members.ts:452` | Demoted viewer keeps channels | After role change `syncWorkspaceChat(tx, orgId, id, viewer?'remove':'add')` |
| 7.4 | X | `0012:142-166`, `messaging/cards.ts:81-91` | Live payloads carry ids only; per-viewer checks | None (see N55) |
| 7.5 | X | `org-updates.ts:104-111` | Hide sets `hiddenFromOrgAt`; post stays | None (undo: N50) |
| 7.6 | X | `workspace/updates.ts:2606-2614`, `org-updates.ts:219-224` | No admin gate | None |
| 7.7 | X | `messaging/queries.ts:64-77` | Paged with `CHAT_PAGE_SIZE` | None |

### A4–A7 new findings (N39–N64)

| id | Sev | Location | Problem | Fix |
|---|---|---|---|---|
| N39 | P1 | `WDC:299-306,623-636`, `settings-policies.ts:373` | Org admin not on a child team sees Settings tab, click fails, `?tab=settings` = "Tab unavailable" | `canManageSettings: canManageProjectSettings || isInheritedAdmin` in `switchTab`, both effects, `resolvedActiveTab` |
| N40 | P1 | `0014:1467-1475,1481` | Viewer promoted to member never gets #general | Same as 7.3 (`'add'`) |
| N41 | P2 | `org-dashboard.ts:223,234`, `permissions.ts:67` | Viewers get class-wide assignment counts | `orgCan(...,'see_class_overview')` |
| N42 | P2 | `0034:93-101`, `OrgOverviewParts.tsx:238`, `OrgWorkspacesTab.tsx:109-117` | `live:workspace` fires on view-count bumps → every open Overview refetches the heavy read | Trigger skips when only `view_count`/`followers_count` change; drop that subscription on Dashboard/Workspaces |
| N43 | P2 | `org-dashboard.ts:185-304` | Loads every member for 8 avatars; ~12 sequential awaits; `ownCopies` 3× | `count(*)` + `LIMIT 8`; `ownCopies` once; `Promise.all` |
| N44 | P2 | `org-dashboard.ts:460-495` | Workspaces read: all 200 rows' subqueries then JS filter; all copies loaded to keep 1 | Visibility in WHERE; `DISTINCT ON (workspace_id)` |
| N45 | P2 | `workspaces/server/detail.ts:637,668-732` | `readOrgDetail`, `readChildOrgLink` after the shell, sequential | `Promise.all` all three |
| N46 | P2 | `schema:1963-1986`, `org-updates.ts:89-94` | Shared-to-org feed part unindexed | Partial index (Part D) |
| N47 | P2 | `org-workspace.ts:198`, `route:120-123` | "To review" links lose `drawerId` in redirect → submission never opens | `assignmentHref(path, id)` |
| N48 | P1 | `children.ts:82-97` | Move-in = 3 steps without transaction | `db.transaction`, pass `tx` |
| N49 | P3 | `OrgWorkspacesTab.tsx:117` | Subscribes to org topics; child changes never arrive | Drop the false live subscription; keep 120 s refetch |
| N50 | P3 | `0038:2-12`, `useUpdateLive.ts:205` | Shared posts not live in org feed; hide not live; no un-hide | `update.changed` on org topic for share/hide; un-hide action |
| N51 | P3 | `workspace/updates.ts:777-780,2424` | Viewers can comment/like on child posts | Check `access.org?.viewerRole === 'viewer'` there too |
| N52 | P3 | `OrgOverviewParts.tsx:360` | Members' People rail links to a tab they can't open | Link only for admins (or D-A) |
| N53 | P3 | `route:145-152` | Signed-out member at org-only workspace has no sign-in link | Add `/login?redirect=…` |
| N54 | P3 | `route:116` | Crawler preview uses `/workspaces/<slug>` for `/org` | Use `base` |
| N55 | P3 | `workspace/updates.ts:1729-1731` | "Also share in #general" ignores audience → "restricted" card for all | Only when audience empty |
| N56 | P3 | `WDC:1131,1170` | Join shows on org scheduled for deletion | `&& !deletionScheduledAt` |
| N57 | P3 | `organizations/detail.ts:136,195` | Visitors get `deletionScheduledAt` and a count including private workspaces | Admin-only field; visible-only count |
| N58 | P3 | `OrgOverviewParts.tsx:347`, `OrgAboutTab.tsx:86`, `OrgWorkspacesTab.tsx:427`, `org-dashboard.ts:385` | One child workspace, three looks; About lacks cover | Part C design rule; select `coverImage` |
| N59 | P3 | `organizations.ts:650-656`, `OrgWorkspacesTab.tsx:690` | Assign-lead candidates show initials only | Select `avatar_url` |
| N60 | P3 | `OrgOverviewParts.tsx:430`, `OrgAboutTab.tsx:43`, `ChildUnitsPanel.tsx` | `['child-units']`, `['org-about']` never invalidated after edits | Invalidate in `ChildUnitsPanel` reload and `handleProjectSettingsUpdated` |
| N61 | P3 | `org-updates.ts:70-77,162-191`, `assignments.ts:1291-1293`, `cards.ts:84-88` | Audience rule copied 5×, already drifting | One `audienceSql` / `nb_update_audience_ok` |
| N62 | P3 | `workspaces/server/detail.ts:291-293` | Move-to-org picker lists dead orgs; runs every page view | Status filters; load when Settings opens |
| N63 | P3 | `child-units.ts:192-201` | Team-task moves after commit | Inside the tx |
| N64 | P2 | `org-members.ts:157,174-178` | Roster build is 2,000 × 2,000 scan | Group by user into a `Map` once |

### A8. Documents, files, storage (8.1–8.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 8.1 | C (other cause) | `upload/upload-intents.ts:440-470`, `organizations/limits.ts:32-35` | Hand-ins skip the 5 GB cap but sit on the same quota row; 100 students × 50 MB fills it and admins are locked out | Admin uploads: subtract hand-in bytes (`n.task_id IS NOT NULL`, same rule as `FILE_KIND 'submissions'`) before `assertStorageQuotaAdmission`; show split in `readOrgStorageAction`. No new columns |
| 8.2 | P | `upload-intents.ts:445-447` | 50 MB hand-in sum counts trashed files and all old versions; members can't empty trash | `AND n.deleted_at IS NULL AND v.version = n.current_version` |
| 8.3 | P | `storage/asset-deletion.ts:29,382-392`, `inngest/functions/storage-asset-deletion.ts:13`, `workspace-files-permanent-delete.ts:16`, `org-files.ts:468` | Counter right, but bytes free only every 2 h × 500 assets platform-wide; trash expiry 20 per 6 h; no reconcile | Loop batches until short; raise trash limit; show "frees within 2 h"; weekly reconcile of `retained_bytes` |
| 8.4 | P | `files/mutations.ts:829-1003`, `files/internal-helpers.ts:118-140` | Admin moving a file from Admins-only into Public folder publishes it silently | Compare `effectiveAccess`; more open → `confirm` + same preview as `setFolderAccessAction` |
| 8.5 | C | `org-docs.ts:302`, `OrgDocParts.tsx:83-90` | Second same-day template copy fails after upload | Add " (2)", " (3)" in `readOrgTemplateCopyAction` |
| 8.6 | X | `OrgDocParts.tsx:350-363` | No template packages (see N87) | None |
| 8.7 | X | `org-workspace.ts:248,275,324` | No content search; filename ILIKE ≤500 docs; trigram exists (see N80) | None |

### A9. Sprints, assignments, review (9.1–9.7)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 9.1 | C | `assignments.ts:434,695-696`, `task-review-snapshot.ts:28-52` | "Edit for everyone" changes pending copies' hash → Approve fails for the class | Copies' hash excludes title/description (holders can't edit them, `assignment-rules.ts:175-177`). No revisions table |
| 9.2 | C | `assignments.ts:1022-1033` | New step lands on pending/approved/excused copies | Skip copies pending or done |
| 9.3 | P | `subtask-write-scope.ts:9-50`, `HandInSection.tsx:106,195` | UI locks steps; server `lockSubtaskWriteScope` ignores review state | Refuse non-admins when copy pending or done |
| 9.4 | P | `assignments.ts:653-654`, `drizzle/0054:17` | `max+1` race → raw unique error (data safe) | `FOR UPDATE` on the copy first, re-check state (also N69) |
| 9.5 | P | `assignments.ts:758-767`, `AssignmentsPanel.tsx:571-574` | Batch stops at first hash mismatch; client loops per copy | try/catch per copy → `{approved, failed}`; "Approve selected" uses the server batch |
| 9.6 | C | `actions/task.ts:771`, `task-transition-service.ts:274-313` | Server resubmit on copies skips hand-in checks and records no version | Refuse resubmit for copies: "Use Hand in" |
| 9.7 | X | `server/sprints.ts:590-644,2044` | Pending work counts as unfinished | None (see N82) |

### A10. Scale, database, cache (10.1–10.6)

| # | V | Real location | What is true | Fix |
|---|---|---|---|---|
| 10.1 | P | `db/index.ts:17-41` | Supavisor transaction pooler already used; `max: 10` per process fixed | `DB_POOL_MAX` env; size replicas × max under pooler limit; confirm Railway URL is the pooler |
| 10.2 | P | `organizations/detail.ts:245`, `workspace-route.tsx:50` | No cross-request cache, but repeated reads within one request cost more | Reuse within a request (`ownCopies`, viewer access). Only if measured: `unstable_cache` on `readOrgCard` tagged `org:<id>`. No L1/L2 Redis cache |
| 10.3 | P | `org-files.ts:284-318`, `assignments.ts:841` | Submissions = one query, 5,000 rows to browser unpaged; heavier reads elsewhere | Page it; counts in SQL (`readMasterProgress`) |
| 10.4 | P | `assignments.ts:139` | Redundant org `FOR UPDATE` (numbering already serialized) | Delete the line |
| 10.5 | P | `organizations/members.ts:177-181`, `workspace-route.tsx:167` | `stampOpened` writes every page render | `AND (last_opened_at IS NULL OR last_opened_at < now() - interval '1 minute')`. No Redis buffer |
| 10.6 | X | schema, `drizzle/` | Coverage broad; real gaps listed in Part D | Part D |

### A8–A10 new findings (N65–N91)

| id | Sev | Location | Problem | Fix |
|---|---|---|---|---|
| N65 | P1 | `files/internal-helpers.ts:203-331` | Every org file write locks the org row `FOR UPDATE` → deadline hand-ins run one at a time, hit 8 s timeout | `FOR KEY SHARE` on `workspaces`, `FOR SHARE` on member row |
| N66 | P1 | `task-transition-service.ts:140` | Every board move locks the org | `FOR UPDATE OF t FOR KEY SHARE OF p` |
| N67 | P1 | `join.ts:137,172`, `organizations/assignments.ts:280-293` | Join holds org lock while creating copies → class joining at once times out | Copies after commit, own tx |
| N68 | P1 | `org-members.ts:277-292` | Approve-all: 500 × copy creation under the lock | One `createCopies` per open assignment after adding |
| N69 | P1 | `assignments.ts:613-670` | Hand-in can flip an approval back to pending | `FOR UPDATE` copy + re-check |
| N70 | P1 | `assignments.ts:841-844` | One bound parameter per copy → fails past 65,534 copies; members load every copy | Subquery by `assignment_id`; viewer's copies only |
| N71 | P1 | `sprint-schedule.ts:58-95` | Auto-start `LIMIT 100` jams on blocked sprints → nothing auto-starts, sprint-publish never fires | Exclude workspaces with an active sprint, or cursor |
| N72 | P2 | `assignment-publish.ts:38-55` | A failing scheduled draft retries hourly and holds its slot | On failure clear `publishAt`, note the error |
| N73 | P2 | `files/versions.ts:448-500` | Admin can delete the version a hand-in points to | `assertCopyFilesOpen` |
| N74 | P2 | `assignments.ts:446,473-496,1048`, `org-docs.ts:367`, `assignment-notify.ts:73-90` | Remind/extend/return/due-move/doc reminders: ~4 sequential queries per copy | One `notifyOrg` per zone or one Inngest fan-out |
| N75 | P3 | `assignments.ts:473-481` | Extend selected stops at first failure, reports success | Continue; return failures |
| N76 | P3 | `assignments.ts:853`, `org-files.ts:300`, `needs-you.ts:232`, `org-members.ts:131,644` | Late/Missing labels differ (default 15 min vs assignment grace) | Pass assignment grace everywhere (closes the ponytail at `assignment-rules.ts:70`) |
| N77 | P2 | `org-members.ts:626-647` | Progress export: 50,000 rows through an action, silently cut | Streaming CSV route + truncated flag |
| N78 | P2 | `needs-you.ts:215-243`, `org-dashboard.ts:123,152-216` | Admin dashboard loads every copy and member | SQL filter overdue/unfinished; key lookups |
| N79 | P2 | `tasks.ts:134-170` | Badges scan all org tasks incl. copies, ~14 counts | `AND (assignment_id IS NULL OR own)` |
| N80 | P2 | `org-workspace.ts:232,292-327` | 2-char cross-org search scans platform tasks per keystroke; loops | 3 chars unless scoped; viewer's orgs first |
| N81 | P2 | `organizations/org-updates.ts:86-99` | OR blocks index scan in the org feed | Child ids first, `workspace_id = ANY(:ids)` |
| N82 | P2 | `server/sprints.ts:1988-1993` | Inner sprints closed before the target is validated | Validate first |
| N83 | P2 | `organizations/sprints.ts:139-165` | Matching sprints: 200 × lock+insert+event in caller tx | One `INSERT … SELECT` |
| N84 | P2 | `asset-deletion.ts:29,212`, `workspace-files-permanent-delete.ts:16` | Platform frees ~6k assets/day; quota relief lags days | Same as 8.3 |
| N85 | P3 | `org-docs.ts:76-82,222-226` | Doc settings read-modify-write loses updates | `jsonb_set` merge in SQL |
| N86 | P3 | `org-docs.ts:213-218` | Two publishes at once → raw unique error | `FOR UPDATE` doc row |
| N87 | P3 | `OrgDocParts.tsx:83-90`, `AddDocDialog.tsx:45-54` | Template copy = 3–4 browser calls; failure leaves stray file | One server action; clean up |
| N88 | P3 | `org-docs.ts:241-251` | Opening a doc lists every doc to map slug | Lookup by `(workspace_id, slug)` |
| N89 | P3 | `assignments.ts:793-806` | Excusing pending work leaves it pending, hidden from queue | Block: "Approve or return first" |
| N90 | P3 | `org-files.ts:213-219` | `readOrgStorageAction` lacks `see_storage` | Pass it |
| N91 | P3 | `supabase_realtime` publication | `workspaces`, `tasks` decoded for Realtime with no subscriber | Drop from publication after checking clients |

### Lock map (every `FOR UPDATE` in org code)

Hot paths that must stop locking the org row: file writes (N65), board moves (N66), join (N67), approve-all (N68), `tasks.ts:1098` task number (use `UPDATE … RETURNING` like `insertTask`), `assignments.ts:139` (10.4), `organizations/sprints.ts:140` (N83), `files/permanent-delete.ts:227` (lock once per batch). Keep: quota row (`upload-intents.ts:396-416,855-873`), rare admin actions (`server/sprints.ts:1458,1640,2338,2468`, `org-updates.ts:113`, `organizations.ts:342`, `lifecycle.ts:391`, `workspace/updates.ts:2003`, `task-completion.ts:74`, `workflow.ts:76`), single-row locks (`assignment-publish.ts:17`, `assignments.ts:695,1082`, `files/versions.ts:467`).

---

## Summary of counts

| Source | Count | Real (C/C+/P) | Not real / fixed |
|---|---|---|---|
| Report findings | 73 | 53 (23 confirmed, 30 partly) | 20 (19 not real, 1 fixed) |
| Report migration indexes | 21 | 0 usable as written (wrong tables/columns, duplicates, `CONCURRENTLY` inside `BEGIN`, partitioned table) | 21 |
| New findings (this audit) | 91 (N1–N91) | 91 | — |
| Missing indexes (real schema) | 13 + 2 drops | 15 | — |
| Architecture moves (Part B) | 10 | — | — |
| Design / role-view items (Part C) | 16 | — | — |
| Carried-over open items (Part E0) | 9 | — | — |

---

## Part B — Architecture moves (the well-architected alternative to the report)

The report patches each path separately. Most bugs above exist because the same job is done in 3–5 places that drifted. Ten moves close whole groups of findings with less code than patching each one:

| # | Move | Replaces | Closes |
|---|---|---|---|
| B1 | **One join pipeline** `joinOrganization(tx, {orgId, userId, via: 'code'|'invite'|'page'|'request'|'onboarding'})` in `src/lib/organizations/join.ts`: block check → `accountOrgLimit` with advisory lock → seats (team full ⇒ join org without team, tell lead) → close the address's open invite → membership. After commit: copies (`createCopiesForNewMember`), `notifyJoined`, join-request notices | `joinOrgByCode`, `acceptOrgInvite`, `joinPublicOrg`, onboarding loop, approve loop | 2.1, 2.2, 2.4, 2.5, 2.6, 2.10, N2, N3, N6, N10, N11, N13, N36, N67, N68 |
| B2 | **One membership-change function** for role change / remove / leave / demote: real actor, admin cap incl. open admin invites, viewers never on workspaces, chat sync both ways, clear takeover request, lead check | `changeMemberRoleAction`, `removeFromOrg`, move/add-to-workspace paths | 2.3, 3.1, 3.4, 3.5, 3.7, 7.3, N16, N38, N40 |
| B3 | **One hand-in pipeline**: lock the copy row, re-check state, insert version, hash rule without title/description; Hand in, resubmit, approve, return, batch approve, excuse all go through it | `submitAssignmentAction`, `resubmitTaskReviewAction` for copies, `reviewOne`, client loops | 9.1–9.6, N69, N89 |
| B4 | **Lock policy**: per-person paths never take `FOR UPDATE` on the org row; use `FOR KEY SHARE`; a contract test greps the hot files | scattered locks | 10.4, N65, N66, N67, N68, N83, `tasks.ts:1098`, `permanent-delete.ts:227` |
| B5 | **One live hook** `useOrgLive({orgId, viewerId, onChange})` built on `useReloadOnNotice`: org topics + personal-topic notices, jittered refetch, ignores view-count noise | ad-hoc subscriptions in Overview, Workspaces, badges, feed | 5.1, 5.2, 5.6, N42, N49, N50 |
| B6 | **Fan-out rule**: any notice to more than 50 people goes through one Inngest event using existing notification functions | per-copy loops in actions | N74, N75, digests ceiling (`org-digests.ts:87`) |
| B7 | **Actions never throw to the client**: one `orgActionError(e)` maps 42501 (block), `AccountOrgLimitError`, "Role is full", limit blocks to messages; the three join helpers also `.catch` → toast | thrown errors reaching the error boundary | 2.1, 2.5, N14, N37 |
| B8 | **One audience rule** `audienceSql` (or `nb_update_audience_ok`) everywhere | 5 hand copies | N55, N61 |
| B9 | **Role-scoped payloads**: `readOrgDetail` and the dashboard return fields by role (visitor < viewer < member < admin) | one payload for all | N41, N57 |
| B10 | **Read budget per tab**: one `Promise.all` round, counts in SQL, viewer's own rows only, no JS-side filtering of SQL rows; budget checked by benchmark | sequential awaits, full-table loads | 10.2, 10.3, N18, N19, N35, N43, N44, N45, N64, N70, N78, N79, N81, N88 |

---

## Part C — Design consistency and role views (owner, admin, member, viewer, visitor)

Real rules today (`settings-policies.ts:356-371`): About open to all; Members admins only; Overview, Workspaces, Tasks, Settings for people in the org (viewers included); visitors land on About. Every item below uses the shared parts from the design work (`org-ui.tsx`, `ui/notice.tsx`, `.nb-*`, `display.ts`) and decisions D1–D7.

| # | Rule / fix | Where | Closes |
|---|---|---|---|
| C1 | One object, one component: a child workspace is `WorkspaceRow` in rails (Overview, About) with the same meta (lead, members, cover) and the Discover card in the Workspaces grid; About selects `coverImage` | `OrgOverviewParts.tsx:347`, `OrgAboutTab.tsx:86`, `org-dashboard.ts:385` | N58 |
| C2 | Every people list: `UserAvatar` with photo, role as `.nb-status` neutral using `roleNames`, title as `.nb-meta` | Assign-lead dialog `OrgWorkspacesTab.tsx:690`, invite lists, request rows | N59 |
| C3 | Members' People view (D-A): read-only Members tab for members — same row component as the admin roster, without email, stats or actions | `OrgMembersTab.tsx`, `org-members.ts:89`, `settings-policies.ts:368`, `OrgOverviewParts.tsx:360` | 5.7, N52 |
| C4 | Role-view matrix test: one browser spec opens every org tab as owner, admin, member, viewer, visitor at 1280 and 390 px, light and dark; asserts tab list, landing tab, no link to a tab the role can't open, no write control for viewers, no page error, no sideways scroll | `tests/browser/org-roles.spec.ts` (new) + fixture | N39, N52, N53, N51, 7.2, live-check #46 |
| C5 | Member/viewer Settings: My membership, What's allowed, Privacy, Leave render and work | `WorkspaceSettingsTab.tsx` org branch | live-check #46 |
| C6 | Errors: field errors inline (as `InstantSwitch`/`useSave` now do), page errors as `Notice`, never the error boundary | B7 helpers | N37 |
| C7 | Toasts from results, organization noun: "N approved · M stay waiting", "Added 3 · 1 skipped", "Invite canceled" only when deleted, "Creating organization…" | `OrgMembersTab.tsx:354,372`, `OrgRequestsSection.tsx:94`, `useCreateWorkspaceWizard.ts:653,657,1001` | N9, N15, N17, N26, N75 |
| C8 | Org visibility box in Settings uses D2 words (Public / Organization only / Private) via `visibilityLabel` and `Notice`, not `bg-muted/20` | `WorkspaceSettingsTab.tsx:1508-1512` | design gap |
| C9 | Shared Radix `Select` trigger is 13 px on desktop (`md:text-sm`) while `Input` and `.nb-select` are 15 px; spec says input-matched → 15 px | `src/components/ui/select.tsx:36` | design gap |
| C10 | `.nb-tag` stays a pill (D-C); contract test pins it | `globals.css`, `org-design-contract.test.ts` | open from chip work |
| C11 | Loading skeleton mirrors the shell: 64 px image, full width, real tab height and count, body = `DashboardSkeleton` | `workspaces/[slug]/loading.tsx` | 4.4 |
| C12 | Honest states: storage "frees within 2 h", pending-deletion banner for admins only, "lead left" row has Assign lead | `OrgStorageSection.tsx`, `OrgWorkspacesTab.tsx` | 8.3, 6.1, N57 |
| C13 | No dead ends: Sign in keeps the return path; Decline refreshes; "To review" opens the submission; Join hidden when deleting | `PrivateOrgHeader.tsx:33,17`, `route:145-152`, `org-workspace.ts:198`, `WDC:1131,1170` | 4.3, N22, N47, N53, N56 |
| C14 | Viewer is read-only everywhere: no reply/like/channel controls shown (UI) and refused (server) | updates, chat | N51, 7.2 |
| C15 | Keyboard: tab bar always reachable; dialogs return focus | `WorkspaceLayout.tsx:489` | 4.7 |
| C16 | Same object, same words: Late/Missing/Behind/Inactive computed by one rule and one grace everywhere (roster, list, Submissions, Members, CSV, Overview) | `assignment-rules.ts`, `member-rules.ts`, `needs-you.ts` | 5.4, N76 |

---

## Part D — Database migration (replaces the report's `0085`)

The report's script cannot run: 20 of 21 indexes name tables/columns that don't exist, the 21st duplicates a primary key, `CONCURRENTLY` is inside `BEGIN/COMMIT`, and `chat_messages` is partitioned.

**`drizzle/0067_org_hot_path_indexes.sql`** — non-transactional (add to `NON_TRANSACTIONAL_MIGRATIONS` in `scripts/setup-database.ts:39`), one `CREATE INDEX CONCURRENTLY IF NOT EXISTS` per `--> statement-breakpoint`, journal entry in `drizzle/meta/_journal.json`, matching `index()` entries in `schema/index.ts`:

1. `tasks_org_masters_idx` on `tasks (workspace_id, due_date) WHERE kind='assignment' AND assignment_id IS NULL AND deleted_at IS NULL`
2. `tasks_copy_pending_review_idx` on `tasks (assignment_id, (coalesce(review_submitted_at, updated_at)), id) WHERE review_status='pending' AND deleted_at IS NULL AND excused_at IS NULL AND assignment_id IS NOT NULL`
3. `tasks_board_no_copies_idx` on `tasks (workspace_id, status, position DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL AND assignment_id IS NULL`
4. `tasks_assignment_drafts_idx` on `tasks (created_at) WHERE kind='assignment' AND assignment_id IS NULL AND deleted_at IS NULL AND (assignment_settings->>'publishedAt') IS NULL`
5. `workspace_sprints_autostart_due_idx` on `workspace_sprints (start_date, id) WHERE status='planning' AND auto_start`
6. `workspace_nodes_trashed_at_idx` on `workspace_nodes (deleted_at) WHERE deleted_at IS NOT NULL`
7. `assignment_submissions_submitted_by_idx` on `assignment_submissions (submitted_by) WHERE submitted_by IS NOT NULL`
8. `workspace_nodes_active_file_size_idx` on `workspace_nodes (workspace_id, size DESC NULLS LAST) WHERE type='file' AND deleted_at IS NULL`
9. `workspace_updates_shared_to_org_idx` on `workspace_updates (workspace_id, created_at DESC) WHERE shared_to_org_at IS NOT NULL AND hidden_from_org_at IS NULL AND deleted_at IS NULL` (N46)
10. `org_email_invites_org_created_idx` on `org_email_invites (org_id, created_at)` (N18)
11. `workspaces_takeover_requested_by_idx` on `workspaces (takeover_requested_by) WHERE takeover_requested_by IS NOT NULL` (N33)
12. `org_member_away_user_idx` on `org_member_away (user_id)` (N33)
13. `org_verification_codes_user_idx` on `org_verification_codes (user_id)` (N33)
14. `DROP INDEX CONCURRENTLY IF EXISTS workspace_nodes_deleted_at_partial_idx` and `tasks_deleted_at_partial_idx` (store only NULLs; same pattern 0027 removed)

Each index ships only if `EXPLAIN (ANALYZE, BUFFERS)` on the local database shows its query moving off a sequential/bitmap scan (TDD: plan captured before and after).

**`drizzle/0068_org_chat_roles_and_realtime.sql`** (transactional): `chat_create_channel` / `chat_join_channel` treat an org viewer as not a member (7.2); `live:workspace` trigger skips updates that change only `view_count`/`followers_count` (N42); remove `workspaces` and `tasks` from `supabase_realtime` after confirming no client uses `postgres_changes` (N91). Also add the existing `UNIQUE (copy_id, version)` to the Drizzle schema (drift found in 9.4).

---

## Part E — Phases (every item has one home)

Rules for every phase (from CLAUDE.md): start with `ponytail-audit` cut list and `ponytail-debt` ledger; `freeze` to the phase's folders; test first for SQL and query changes (`superpowers:test-driven-development`); `benchmark` before and after; `ponytail-review` then `review`; commit locally with `caveman-commit` style; **no push, no `db:setup`, no Railway until the user says**.

**E0 — Carried-over open items (9)**
1. Signed-in check of org screens on real data (design work).
2. Student account: own board and Hand in (live-check "not checked").
3. Review, Return, Extend on a real copy.
4. Mark away.
5. Notifications and emails for org events.
6. Live updates across two browsers.
7. Calendar link.
8. Compat cleanup due "next release": drop terminology compat views and workspace `status_*` columns (`schema:309-310,830`).
9. Ponytail ceilings re-measured: roster per open (`org-members.ts:94`), all children per dashboard (`org-dashboard.ts:459`), storage summed per open (`org-files.ts:425`), digests per person (`org-digests.ts:28,87`); upgrade only where Phase 0 numbers say so.

**Phase 0 — Measure (no code).** Record per-tab time to content (baseline from 4 Nov: Overview 0.76 s, Tasks 0.55, Workspaces 0.37, Members 0.56, Files 0.65, Sprints 0.51, Updates 1.36, Documents 2.34), query count per tab open, and `EXPLAIN` of the hot queries in Part D, on a seeded org (2,000 members, 200 workspaces, 30 assignments). Targets: every tab ≤ 0.8 s, ≤ 1 round of parallel queries per open, no sequential scan on hot tables.

**Phase 1 — Security and data integrity (P0/P1).** 1.2 (via N1), 2.3, 2.8, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.6, N1, N2, N4, N5, N34, N38, N39, N40, N48, N69, N73. (Starts B2 and B3.)

**Phase 2 — Locks, jobs, indexes (scale).** B4 and B6; 8.3, 10.1, 10.4, 10.5, N33, N65, N66, N67, N68, N70, N71, N72, N74, N83, N84, N91; migrations 0067 and 0068.

**Phase 3 — Join and membership pipelines, errors.** B1, B2 (rest), B3 (rest), B7, B8; 2.1, 2.2, 2.4, 2.5, 2.6, 2.10, 3.1, 9.5, N3, N6, N7, N8, N9, N10, N11, N12, N13, N14, N15, N16, N17, N23, N24, N25, N36, N37, N51, N55, N61, N82, N86, N89.

**Phase 4 — Reads and live updates (speed).** B5, B9, B10; 4.5, 4.6, 5.1, 5.2, 5.4, 5.5, 5.6, 10.2, 10.3, N18, N19, N20, N21, N35, N41, N42, N43, N44, N45, N46, N49, N50, N57, N60, N64, N78, N79, N80, N81, N88.

**Phase 5 — Workflow and design.** Part C (C1–C16); 1.3, 1.4, 1.5, 2.9, 4.1, 4.2, 4.3, 4.4, 4.7, 5.7, 6.1, 6.4, 6.6, 6.7, 7.1, 8.4, 8.5, N22, N26, N27, N28, N29, N30, N31, N32, N47, N52, N53, N54, N56, N58, N59, N62, N63, N75, N76, N77, N85, N87, N90.

**Phase 6 — Carry-overs and close.** E0 items 1–9; 1.7 (alert on stuck purges); re-run Phase 0 measurements and record before/after in the plan's Status section.

Coverage check: all 53 real report findings and N1–N91 appear exactly once above; the 20 not-real report findings need no work.

---

## Part F — What the report proposed that we will not build (and when we would)

| Report proposal | Why not now | Build it when |
|---|---|---|
| PgBouncer (10.1) | Supavisor transaction pooler already in use | Pool waits show in metrics after B4 |
| L1 LRU + L2 Redis cache (10.2) | Reads are per-role and by primary key; repeated in-request reads cost more | A measured read stays > budget after B10 → `unstable_cache` with tags first |
| Redis Bloom filter for handles (1.3) | 3 indexed lookups; rate limit is enough | Never at current scale |
| Materialized view for submissions (10.3) | One query already; paging fixes it | Submissions read > 300 ms after paging |
| `org_outbox_events` table (1.2) | Inngest exists; invite failures already become notices | — |
| `org:<id>:admin_events` SSE channel (5.1) | Personal topics already carry the events | — |
| `assignment_revisions` table (9.1) | Hash rule change is enough | Teachers need to see old instruction versions |
| Sequences / UUIDv7 (10.4) | Deleting the extra lock is enough | — |
| Redis access-ping buffer (10.5) | One-minute SQL throttle is enough | `workspace_members` write rate shows in metrics |
| Partial unique handle index (1.7) | Would break 30-day restore | — |
| `org_feed_shares` table (7.5) | Hide already detaches | — |
| Separate storage columns (8.1) | Subtracting hand-in bytes is enough | Separate billing of hand-ins |
| 1 GB per-user pool | Out of this scope (monetization plan) | Monetization build |

---

## Part G — Verification

- **Per item**: the test named with it — unit for rules (`tests/unit/org-*.test.ts`), database tests for SQL/locks/races (`tests/db/*`, written first), browser specs for UI (`tests/browser/org-*.spec.ts`, run with `--project=chromium`; Firefox cannot launch here).
- **Contract tests**: design contract (`tests/unit/org-design-contract.test.ts`, 25 checks) stays green; new lock-policy contract (B4) and role-view matrix spec (C4).
- **Races** (2.10, 9.4, N69, N67): two concurrent transactions in `tests/db`, asserting one result and no raw error.
- **Indexes**: `EXPLAIN (ANALYZE, BUFFERS)` before/after for each Part D index on the seeded org.
- **Speed**: `benchmark` per phase against Phase 0 numbers; targets in Phase 0.
- **Suite baselines**: `npx tsc --noEmit -p .`; `npm run -s test:unit` (4 known failures from the CLI commit stay the only ones); org/settings browser specs (91 today).
- **Live** (only when the user says): migrations, deploy, then E0 checks signed in with an owner and a student account.

## Decisions (answered by the user, 2026-11-09)

- **D-A — Members get a read-only People list.** The Members tab becomes visible to members (not viewers or visitors) in a read-only form: name, photo, role (org role names), title; no email, work stats, filters for behind/inactive, or actions. Server: `readOrgMembersAction` returns this projection for non-admins (B9); `isWorkspaceTabVisibleToViewer` (`settings-policies.ts:368`) allows `members` for member role; the Overview People rail links to it for members. Admins keep the full tab. Covered by C3 and the C4 role-view spec. Phase 5.
- **D-B — Takeover requests expire after 14 days, and takeover re-checks the owner is still away.** Implemented in `takeover-rules.ts` / `takeOverOrg` with N4. Phase 1.
- **D-C — `.nb-tag` stays the spec's pill**; status badges stay square. C10 needs no code; the design contract test gains a check that `.nb-tag` keeps its pill radius.

Defaults already taken (Ponytail): 1.1 starter doc stays off; 2.9 decline is immediate with no Undo; 3.2 delete needs step-up; 8.1 no new storage columns; no new infrastructure (Part F).

On "implement", this file is copied to `docs/superpowers/plans/2026-11-09-org-workflow-audit.md`.
