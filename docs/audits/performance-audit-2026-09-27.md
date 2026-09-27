# NetworkBase performance audit — 2026-09-27 (v4, implemented on main)

Scope: full app (`src/`, 1,045 files, 278k lines), production Railway service, Supabase `ap-southeast-1`. Method: code + import-graph scan, live `pg_stat_statements`, Supabase advisors, Railway metrics, production curl and browser timings. Style: caveman-lite. Ponytail convention: reuse what exists, add no dependency. Nothing was deleted or changed.

**95 unique issues (119 entries; PT items marked *also* overlap a v1 ID)** — P0 4 · P1 20 · P2 60 · P3 35

## Implementation plan (v5)

356 of 356 report items mapped to exactly one of 47 tasks (missing 0, duplicates 0). Full plan: `docs/superpowers/plans/2026-09-27-networkbase-speed-audit.md`. Order rule: deploy main first (P1); the Docs migration and every DROP/RENAME run after.

| Task | Title | Items |
|---|---|---:|
| T0.1 | Commit the cleanup already applied to main | 12 |
| T0.2 | Record the baseline | 26 |
| T1.1 | Make main the production branch (deploy before dropping anything) | 2 |
| T1.2 | Move web and worker next to the database | 1 |
| T2.1 | Docs database migration (after T1.1 is verified) | 1 |
| T2.2 | Remove the leftover co-editing secret | 1 |
| T2.3 | Cut Docs tab round trips from 3 queued actions to 1 | 1 |
| T3.1 | Delete load shedding; co-locate Redis | 4 |
| T3.2 | Rate limits only where abuse is possible | 5 |
| T3.3 | Landing redirect, health checks, heap, network extras | 4 |
| T3.4 | Investigate the 41% 4xx | 1 |
| T3.5 | Tailwind scan scope, view-count write-through | 2 |
| T4.1 | One proxy file with CSP, CSRF and auth | 6 |
| T4.2 | Proxy and layout auth without network or DB calls | 4 |
| T5.1 | Realtime publication trim | 3 |
| T5.2 | Connection pool, single db client | 9 |
| T5.3 | Indexes: add the missing, drop the duplicate | 7 |
| T5.4 | Cron jobs: stop polling empty work | 7 |
| T5.5 | One presence mechanism | 2 |
| T5.6 | RLS and security advisors | 4 |
| T5.7 | Rename SQL objects consistently | 7 |
| T5.8 | Drop unused SQL objects and migration debris | 5 |
| T5.9 | Collapse project_node_events partitions | 3 |
| T5.10 | Query shape: schema reloads, badge counts, N+1, e2e isolation | 4 |
| T6.1 | One name per page: Discover, Network, My profile | 66 |
| T6.2 | Remove duplicate, hidden and empty routes | 6 |
| T6.3 | Merge tiny API routes | 1 |
| T7.1 | Static legal pages and a header-free root layout | 3 |
| T7.2 | Parallel server reads and a streaming shell | 3 |
| T7.3 | Remove next-intl, flags and dead revalidations | 9 |
| T7.4 | Fewer queued server actions per screen (round-trip reductions) | 3 |
| T7.5 | Notification emitters decision | 1 |
| T7.6 | Discover cache and in-flight dedupe | 3 |
| T8.1 | Slim root layout and providers | 5 |
| T8.2 | Skill icons and catalog | 7 |
| T8.3 | Auth pages as server shells | 2 |
| T8.4 | Split the largest components | 2 |
| T8.5 | Timers, polling, invalidation, prefetch, fonts, lists | 6 |
| T8.6 | Native motion, dates and theme | 4 |
| T9.1 | Unused packages and lockfiles | 4 |
| T9.2 | Test-only modules and exports | 3 |
| T9.3 | Telemetry, scale scripts, bloom filter, env knobs | 12 |
| T9.4 | Barrels, aliases, e2e route, conventions, build config | 5 |
| T9.5 | Repo clutter and vendored skills | 5 |
| T10.1 | Claude skill set and workflow | 12 |
| T11.1 | Re-measure and compare | 31 |
| T11.2 | Close the debt ledger and record kept mechanisms | 42 |

## Implemented on main (v4)

238 file changes · +62 / −11,742 lines · net −11,680 (src and tests).

| Step | Exact change | What it removed |
|---|---|---|
| A · Docs tab cleanup | src 24 files, +18 / −3,239 · tests 6 files, +6 / −631 | Removed the Quick Console, doc switcher, doc-style and doc-settings modules; the co-editing token route and its 2 libraries; the doc image-asset route and asset handling; write-only draft fields; the never-enabled doc-edit layout mode; the “Notify on publish” toggle and the mediaUploads setting; 4 unused server actions (validate, create, search, reference options) and ~40 unused doc exports; Drizzle definitions for project_markdown_assets and project_markdown_draft_contributors. |
| B · Unreachable files | src 49 files, −4,594 · tests 7 files, −411, plus 9 files, −52 | Deleted every source file no route, layout, proxy, worker, Inngest function or kept script can reach (list in the Removal ledger), the 7 tests that only covered them, and the lines in 9 contract tests that read those deleted files. |
| C · Unused exports and locals | src 143 files, +38 / −2,815 | Compiler-driven fixpoint: 132 exports with zero references anywhere (incl. tests) → 2,270 lines; 108 unused imports → 154 lines; 29 unused module-level declarations → 314 lines. Largest: lib/notifications/emitters.ts (−351: 9 emitters never called), actions/files/nodes.ts (−290), lib/import/utils.ts (−174), actions/account.ts (−135), actions/messaging/_all.ts (−129). Kept unchanged because a contract test asserts on their text: extension/session route, actions/request-history.ts, FolderListView.tsx, ProjectSettingsTab.tsx, actions/connections.ts. Exports used only by tests were kept. |

**Verification**

- Typecheck: 0 errors in src/ after each step (stale .next/types entries regenerate on the next build).
- Full unit suite on the identical code: 2,109 tests, 44 failing — the same 44 that failed before any change; 0 new failures after A, B and C.
- ESLint on the 143 files changed by step C: 0 errors before, 0 after.
- Every applied file was hash-compared with the verified copy: 0 mismatches.
- Applied to the local main working tree, uncommitted. Backup: git ref refs/backups/pre-ponytail-docs-2026-09-27 plus a tarball of 132 untracked code files.

**Still pending**

- **Docs database migration:** Blocked by the Claude Code safety check (it will not write a file with DROP statements). Objects the code no longer uses: tables project_markdown_assets (0 rows) and project_markdown_draft_contributors (1 row); columns project_markdowns.draft_content, draft_updated_by, draft_updated_at; function app_private.nb_readme_asset_is_public; enum status_readme_asset; settings keys mediaUploads, notifyOnPublish; never-scanned indexes project_markdown_versions_project_created_idx, _project_hash_idx, _created_by_idx. Drop only after production runs this code.
- **Railway variable DOC_COLLABORATION_TOKEN_SECRET:** Unused by main, but production deploys codex/railway-production, which still has the co-editing route; unset it after deploying main.
- **Deploy:** Production still runs codex/railway-production (INF-06). None of the savings reach users until main is deployed.

## Round trips: whole app (v4)

Requests on load = page request + every server action/API call that fires without a click. Counts are reachable data-access call sites per request (all branches).

| Page / tab | Requests | Actions | API | SQL | Auth | Storage | Redis | REST | External | Conditional | Click-time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| App shell (every signed-in page) | 9 | 7 | 1 | 54 | 8 | 0 | 3 | 1 | 0 | 6 | 11 |
| /discover (served by hub/page.tsx) | 4 | 2 | 1 | 49 | 2 | 0 | 14 | 0 | 0 | 1 | 12 |
| /messages | 8 | 6 | 1 | 57 | 7 | 0 | 6 | 0 | 0 | 5 | 34 |
| /network (served by people/page.tsx) | 2 | 1 | 0 | 11 | 1 | 0 | 2 | 0 | 0 | 1 | 0 |
| /my-profile (served by profile/page.tsx) | 9 | 4 | 4 | 69 | 8 | 0 | 3 | 0 | 0 | 0 | 16 |
| /projects/[slug] | 4 | 2 | 1 | 52 | 3 | 0 | 4 | 0 | 0 | 2 | 8 |
| /projects/new | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| /settings | 10 | 4 | 5 | 40 | 9 | 0 | 9 | 0 | 1 | 1 | 11 |
| /u/[username] | 9 | 4 | 4 | 72 | 8 | 0 | 3 | 0 | 0 | 0 | 16 |
| /workspace | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /acceptable-use | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /admin/notifications | 1 | 0 | 0 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| /cookies | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /copyright | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /dpa | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /eula | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /grievances | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /onboarding-preview | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| /open-source | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| / | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /privacy | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /security-reporting | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /subprocessors | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /terms | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Project · Dashboard tab | 1 | 1 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Project · Docs tab | 3 | 3 | 0 | 26 | 4 | 1 | 0 | 0 | 2 | 2 | 0 |
| Project · Updates tab | 8 | 7 | 1 | 53 | 3 | 0 | 4 | 0 | 0 | 6 | 7 |
| Project · Tasks tab | 6 | 6 | 0 | 16 | 4 | 0 | 1 | 0 | 0 | 1 | 5 |
| Project · Files tab | 14 | 14 | 0 | 55 | 13 | 0 | 1 | 0 | 1 | 4 | 33 |
| Project · Sprints tab | 2 | 2 | 0 | 24 | 2 | 0 | 0 | 0 | 0 | 2 | 6 |
| Project · Settings tab | 8 | 6 | 2 | 34 | 8 | 0 | 4 | 0 | 0 | 1 | 25 |

**App shell (every signed-in page)**

- server render `src/proxy.ts#proxy` — SQL 0, Auth 0, Redis 1, REST 1
- server render `src/app/(main)/layout.tsx#default` — SQL 2, Auth 0, Redis 0, REST 0
- action `src/app/actions/workspace.ts#getWorkspaceSummaryAction` via `src/components/layout/header/WorkspaceIndicator.tsx#default` — SQL 5, Auth 1, Storage 0, Redis 0
- action `src/app/actions/notifications.ts#readNotificationUnreadCountAction` via `src/hooks/useNotifications.ts#useNotifications` — SQL 1, Auth 1, Storage 0, Redis 2 (conditional) · staleTime=60_000, refetchOnWindowFocus=false
- action `src/app/actions/notifications.ts#readNotificationsAction` via `src/hooks/useNotifications.ts#useNotifications` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=60_000, refetchOnWindowFocus=false
- action `src/app/actions/notifications.ts#readNotificationPreferencesAction` via `src/hooks/useSettingsQueries.ts#useNotificationPreferences` — SQL 1, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=SETTINGS_STALE_MS, gcTime=SETTINGS_GC_MS, refetchOnWindowFocus=false
- API `src/app/api/v1/profiles/[id]/projects/route.ts#GET` via `src/components/layout/AppSidebar.tsx#fetchSidebarProjects` — SQL 5, Auth 1, Storage 0, Redis 0 (conditional)
- action `src/app/actions/messaging/v2.ts#getConversationThreadPageV2` via `src/components/chat/v2/ChatPopupV2.tsx#ChatPopupV2` — SQL 34, Auth 1, Storage 0, Redis 0 · staleTime=30_000
- action `src/app/actions/messaging/_all.ts#getUnreadCount` via `src/components/providers/MessageAttentionProvider.tsx#MessageAttentionProvider` — SQL 1, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=30_000, refetchOnWindowFocus=false
- action `src/app/actions/connections.ts#readPeoplePendingCountsAction` via `src/components/providers/PeopleNotificationsProvider.tsx#PeopleNotificationsProvider` — SQL 2, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=60_000, refetchOnWindowFocus=false

**/discover (served by hub/page.tsx)**

- server render `src/app/(main)/hub/page.tsx#default` — SQL 14, Auth 1, Redis 6, REST 0
- server render `src/app/(main)/hub/page.tsx#generateMetadata` — SQL 0, Auth 0, Redis 0, REST 0
- action `src/app/actions/connections.ts#getConnectionsFeed` via `src/hooks/useConnections.ts#useConnectionsFeed` — SQL 11, Auth 1, Storage 0, Redis 2 (conditional) · staleTime=tab === 'network' ? 30_000 : 60_000, gcTime=5 * 60_000, refetchOnWindowFocus=false
- action `src/app/actions/hub.ts#fetchHubProjectsAction` via `src/hooks/hub/useHubProjectsSimple.ts#useHubProjectsSimple` — SQL 21, Auth 0, Storage 0, Redis 1 · staleTime=120_000, refetchOnWindowFocus=false
- API `src/app/api/v1/projects/route.ts#GET` via `src/hooks/hub/useHubProjectsSimple.ts#fetchPublicProjectsPage` — SQL 3, Auth 0, Storage 0, Redis 5

**/messages**

- server render `src/app/(main)/messages/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/messages/page.tsx#generateMetadata` — SQL 0, Auth 0, Redis 0, REST 0
- action `src/app/actions/messaging/v2.ts#searchMessageRecipientsV2` via `src/components/chat/v2/NewMessageModalV2.tsx#NewMessageModalV2` — SQL 1, Auth 1, Storage 0, Redis 1
- action `src/app/actions/messaging/features.ts#recordDeliveryReceipts` via `src/components/chat/v2/MessageThreadV2.tsx#MessageThreadV2` — SQL 2, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/link-preview/route.ts#GET` via `src/hooks/useLinkPreview.ts#fetchLinkPreview` — SQL 3, Auth 1, Storage 0, Redis 4 (conditional)
- action `src/app/actions/messaging/v2.ts#getConversationThreadPageV2` via `src/hooks/useMessagesV2.ts#useConversationThread` — SQL 34, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=15_000, refetchOnWindowFocus=false
- action `src/app/actions/messaging/linked-work.ts#readMessageWorkLinksAction` via `src/hooks/useMessageWorkLinks.ts#useMessageWorkLinks` — SQL 2, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=30_000, refetchOnWindowFocus=false
- action `src/app/actions/messaging/_all.ts#searchMessages` via `src/hooks/useMessagesV2.ts#useMessageSearch` — SQL 4, Auth 1, Storage 0, Redis 1 (conditional) · staleTime=20_000, refetchOnWindowFocus=false
- action `src/app/actions/messaging/v2.ts#getInboxPageV2` via `src/hooks/useMessagesV2.ts#useInbox` — SQL 11, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=30_000, refetchOnWindowFocus=false

**/network (served by people/page.tsx)**

- server render `src/app/(main)/people/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/people/page.tsx#generateMetadata` — SQL 0, Auth 0, Redis 0, REST 0
- action `src/app/actions/connections.ts#getConnectionsFeed` via `src/hooks/useConnections.ts#useConnectionsFeed` — SQL 11, Auth 1, Storage 0, Redis 2 (conditional) · staleTime=tab === 'network' ? 30_000 : 60_000, gcTime=5 * 60_000, refetchOnWindowFocus=false

**/my-profile (served by profile/page.tsx)**

- server render `src/app/(main)/profile/page.tsx#default` — SQL 10, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/profile/page.tsx#generateMetadata` — SQL 10, Auth 0, Redis 0, REST 0
- action `src/app/actions/connections.ts#getAcceptedConnections` via `src/components/profile/v2/UserConnectionsModal.tsx#UserConnectionsModal` — SQL 14, Auth 1, Storage 0, Redis 2
- action `src/app/actions/applications/internal.ts#getProjectInviteOptionsAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 7, Auth 1, Storage 0, Redis 0
- action `src/app/actions/matchmaking/resolver.ts#getProfileToRoleAlignmentAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/guidance.ts#getProjectGuidancePreflightAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/contributions/route.ts#GET` via `src/lib/profile/browser-profile.ts#loadProfileContributionsPage` — SQL 5, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/collaboration-summary/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchCollaborationSummary` — SQL 8, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/project-invite-options/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchInviteOptions` — SQL 4, Auth 1, Storage 0, Redis 1
- API `src/app/api/v1/profiles/[id]/projects/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchProfileProjects` — SQL 5, Auth 1, Storage 0, Redis 0

**/projects/[slug]**

- server render `src/app/(main)/projects/[slug]/page.tsx#default` — SQL 24, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/projects/[slug]/page.tsx#generateMetadata` — SQL 15, Auth 0, Redis 0, REST 0
- action `src/app/actions/applications/internal.ts#getApplicationStatusAction` via `src/components/projects/dashboard/ProjectDashboardClient.tsx#default` — SQL 7, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/link-preview/route.ts#GET` via `src/hooks/useLinkPreview.ts#fetchLinkPreview` — SQL 3, Auth 1, Storage 0, Redis 4 (conditional)
- action `src/app/actions/project/_all.ts#getProjectMembersAction` via `src/hooks/hub/useProjectMembers.ts#useProjectMembers` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 60 * 5, gcTime=1000 * 60 * 10, refetchOnWindowFocus=false

**/projects/new**

- server render `src/app/(main)/projects/new/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/settings**

- server render `src/app/(main)/settings/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/settings/page.tsx#generateMetadata` — SQL 0, Auth 0, Redis 0, REST 0
- action `src/app/actions/account.ts#getAccountDeletionStatus` via `src/hooks/useSettingsQueries.ts#fetchAccountDeletionStatus` — SQL 1, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/legal/acceptance/route.ts#GET` via `src/components/settings/LegalAndDataRightsSection.tsx#LegalAndDataRightsSection` — SQL 5, Auth 1, Storage 0, Redis 0
- action `src/app/actions/github-sync.ts#getCurrentGitHubCommitIdentity` via `src/components/settings/GitHubCommitAttributionSettings.tsx#GitHubCommitAttributionSettings` — SQL 2, Auth 1, Storage 0, Redis 0
- action `src/app/actions/extension-sessions.ts#getActiveExtensionSessions` via `src/hooks/useSettingsQueries.ts#fetchExtensionSessionsData` — SQL 2, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/integrations/route.ts#GET` via `src/hooks/useSettingsQueries.ts#fetchIntegrationsData` — SQL 6, Auth 1, Storage 0, Redis 1
- action `src/app/actions/notifications.ts#readNotificationPreferencesAction` via `src/hooks/useSettingsQueries.ts#useNotificationPreferences` — SQL 1, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=SETTINGS_STALE_MS, gcTime=SETTINGS_GC_MS, refetchOnWindowFocus=false
- API `src/app/api/v1/privacy/blocks/[userId]/route.ts#DELETE` via `src/components/settings/PrivacySettings.tsx#unblockAccount` — SQL 8, Auth 1, Storage 0, Redis 6
- API `src/app/api/v1/privacy/route.ts#GET` via `src/hooks/useSettingsQueries.ts#fetchPrivacyData` — SQL 7, Auth 1, Storage 0, Redis 1
- API `src/app/api/v1/security/route.ts#GET` via `src/hooks/useSettingsQueries.ts#fetchSecurityData` — SQL 8, Auth 1, Storage 0, Redis 1

**/u/[username]**

- server render `src/app/(main)/u/[username]/page.tsx#default` — SQL 13, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/u/[username]/page.tsx#generateMetadata` — SQL 10, Auth 0, Redis 0, REST 0
- action `src/app/actions/connections.ts#getAcceptedConnections` via `src/components/profile/v2/UserConnectionsModal.tsx#UserConnectionsModal` — SQL 14, Auth 1, Storage 0, Redis 2
- action `src/app/actions/applications/internal.ts#getProjectInviteOptionsAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 7, Auth 1, Storage 0, Redis 0
- action `src/app/actions/matchmaking/resolver.ts#getProfileToRoleAlignmentAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/guidance.ts#getProjectGuidancePreflightAction` via `src/components/projects/dashboard/InviteCollaboratorModal.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/contributions/route.ts#GET` via `src/lib/profile/browser-profile.ts#loadProfileContributionsPage` — SQL 5, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/collaboration-summary/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchCollaborationSummary` — SQL 8, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/profiles/[id]/project-invite-options/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchInviteOptions` — SQL 4, Auth 1, Storage 0, Redis 1
- API `src/app/api/v1/profiles/[id]/projects/route.ts#GET` via `src/components/profile/v2/ProfileV2Client.tsx#fetchProfileProjects` — SQL 5, Auth 1, Storage 0, Redis 0

**/workspace**

- server render `src/app/(main)/workspace/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0
- server render `src/app/(main)/workspace/page.tsx#generateMetadata` — SQL 0, Auth 0, Redis 0, REST 0

**/acceptable-use**

- server render `src/app/acceptable-use/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/admin/notifications**

- server render `src/app/admin/notifications/page.tsx#default` — SQL 3, Auth 1, Redis 0, REST 0

**/cookies**

- server render `src/app/cookies/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/copyright**

- server render `src/app/copyright/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/dpa**

- server render `src/app/dpa/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/eula**

- server render `src/app/eula/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/grievances**

- server render `src/app/grievances/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/onboarding-preview**

- server render `src/app/onboarding-preview/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/open-source**

- server render `src/app/open-source/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/**

- server render `src/app/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/privacy**

- server render `src/app/privacy/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/security-reporting**

- server render `src/app/security-reporting/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/subprocessors**

- server render `src/app/subprocessors/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**/terms**

- server render `src/app/terms/page.tsx#default` — SQL 0, Auth 0, Redis 0, REST 0

**Project · Dashboard tab**

- action `src/app/actions/project/recent-activity.ts#readProjectRecentActivityAction` via `src/components/projects/dashboard/RecentActivityCard.tsx#RecentActivityCard` — SQL 6, Auth 0, Storage 0, Redis 0 · staleTime=0, refetchOnMount="always", refetchOnWindowFocus=true

**Project · Docs tab**

- action `src/app/actions/project/doc.ts#listProjectMarkdownsAction` via `src/hooks/hub/useProjectDocData.ts#useProjectMarkdowns` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 60 * 5, refetchOnWindowFocus=false
- action `src/app/actions/project/doc.ts#readProjectDocSmartBlockPreviewsAction` via `src/hooks/hub/useProjectDocData.ts#useProjectDocSmartBlockPreviews` — SQL 13, Auth 1, Storage 0, Redis 0 (conditional)
- action `src/app/actions/project/doc.ts#readProjectDocAction` via `src/hooks/hub/useProjectDocData.ts#useProjectDoc` — SQL 10, Auth 2, Storage 1, Redis 0 · staleTime=1000 * 60 * 5, refetchOnWindowFocus=false

**Project · Updates tab**

- action `src/app/actions/project/updates.ts#readProjectUpdatesAction` via `src/components/projects/tabs/UpdatesTab.tsx#default` — SQL 11, Auth 0, Storage 0, Redis 0 · staleTime=20_000, refetchOnWindowFocus=false
- action `src/app/actions/project/updates.ts#readProjectUpdateAction` via `src/components/projects/tabs/UpdatesTab.tsx#default` — SQL 11, Auth 0, Storage 0, Redis 0
- action `src/app/actions/project/updates.ts#readProjectUpdateContextOptionsAction` via `src/components/projects/updates/ProjectUpdateComposer.tsx#ProjectUpdateComposer` — SQL 5, Auth 0, Storage 0, Redis 0 (conditional) · staleTime=30_000
- action `src/app/actions/project/updates.ts#readProjectUpdateDraftAction` via `src/components/projects/updates/ProjectUpdateComposer.tsx#ProjectUpdateComposer` — SQL 3, Auth 0, Storage 0, Redis 0 (conditional)
- action `src/app/actions/files/nodes.ts#getProjectNodes` via `src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx#V3AttachmentPicker` — SQL 6, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=30_000
- action `src/app/actions/files/nodes.ts#getNodeMetadataBatch` via `src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx#V3AttachmentPicker` — SQL 6, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=30_000
- API `src/app/api/v1/link-preview/route.ts#GET` via `src/hooks/useLinkPreview.ts#fetchLinkPreview` — SQL 3, Auth 1, Storage 0, Redis 4 (conditional)
- action `src/app/actions/project/updates.ts#readProjectUpdateCommentsAction` via `src/components/projects/tabs/UpdatesTab.tsx#UpdateComments` — SQL 8, Auth 0, Storage 0, Redis 0 (conditional) · staleTime=15_000, refetchOnWindowFocus=false

**Project · Tasks tab**

- action `src/app/actions/project/workflow.ts#getProjectWorkflowColumnsAction` via `src/components/projects/v2/TasksTab.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0 · staleTime=1000 * 60 * 5, refetchOnWindowFocus=false
- action `src/app/actions/project/_all.ts#getProjectTaskDetailAction` via `src/components/projects/v2/TasksTab.tsx#default` — SQL 3, Auth 0, Storage 0, Redis 0
- action `src/app/actions/laptop-ides.ts#detectInstalledLaptopIdesAction` via `src/hooks/useLaptopInstalledIdes.ts#useLaptopInstalledIdes` — SQL 0, Auth 0, Storage 0, Redis 0
- action `src/app/actions/extension-sessions.ts#getActiveExtensionSessions` via `src/hooks/useSettingsQueries.ts#fetchExtensionSessionsData` — SQL 2, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/_all.ts#fetchProjectSprintsAction` via `src/hooks/hub/useProjectTasksData.ts#useProjectSprints` — SQL 5, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 60 * 5, refetchOnWindowFocus=false
- action `src/app/actions/project/_all.ts#fetchProjectTasksAction` via `src/hooks/hub/useProjectTasksData.ts#useProjectInfiniteTasks` — SQL 3, Auth 1, Storage 0, Redis 1 · staleTime=1000 * 60, gcTime=1000 * 60 * 5, refetchOnWindowFocus=false

**Project · Files tab**

- action `src/app/actions/files/nodes.ts#getNodeMetadataBatch` via `src/components/projects/v2/files-tab/SavedFilesCollection.tsx#SavedFilesCollection` — SQL 6, Auth 1, Storage 0, Redis 0 · staleTime=60_000, refetchInterval=300_000
- action `src/app/actions/files/nodes.ts#getProjectNodes` via `src/components/projects/v2/files-tab/folder/FolderListView.tsx#FolderListView` — SQL 6, Auth 1, Storage 0, Redis 0 · staleTime=60_000, refetchInterval=300_000
- action `src/app/actions/files/content.ts#getProjectFileSignedUrl` via `src/components/projects/v2/explorer/ExplorerTree.tsx#GridThumbnail` — SQL 2, Auth 1, Storage 0, Redis 0 · staleTime=25 * 60_000, gcTime=30 * 60_000, refetchOnMount=false, refetchOnWindowFocus=false
- action `src/app/actions/files/links.ts#getTaskLinksForNode` via `src/hooks/useTaskLinks.ts#useTaskLinks` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=60_000, refetchInterval=300_000
- action `src/app/actions/project/doc.ts#listProjectMarkdownsAction` via `src/hooks/hub/useProjectDocData.ts#useProjectMarkdowns` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 60 * 5, refetchOnWindowFocus=false
- action `src/app/actions/project/_all.ts#getProjectMembersAction` via `src/hooks/hub/useProjectMembers.ts#useProjectMembers` — SQL 3, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 60 * 5, gcTime=1000 * 60 * 10, refetchOnWindowFocus=false
- action `src/app/actions/files/trash.ts#getPermanentDeleteImpact` via `src/components/projects/v2/files-tab/TrashFilesCollection.tsx#TrashFilesCollection` — SQL 8, Auth 1, Storage 0, Redis 1
- action `src/app/actions/files/mutations.ts#getTrashPage` via `src/components/projects/v2/files-tab/TrashFilesCollection.tsx#TrashFilesCollection` — SQL 2, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=60_000, refetchInterval=300_000
- action `src/app/actions/files/collections.ts#getTaskFileGroups` via `src/components/projects/v2/files-tab/TaskFilesCollection.tsx#TaskFilesCollection` — SQL 6, Auth 1, Storage 0, Redis 0 · staleTime=60_000
- action `src/app/actions/laptop-ides.ts#detectInstalledLaptopIdesAction` via `src/hooks/useLaptopInstalledIdes.ts#useLaptopInstalledIdes` — SQL 0, Auth 0, Storage 0, Redis 0
- action `src/app/actions/extension-sessions.ts#getActiveExtensionSessions` via `src/hooks/useSettingsQueries.ts#fetchExtensionSessionsData` — SQL 2, Auth 1, Storage 0, Redis 0
- action `src/app/actions/github-sync.ts#getHeaderGitHubSyncStatus` via `src/components/projects/v2/files-tab/FilesWorkspaceHeader.tsx#HeaderGitHubSyncButton` — SQL 3, Auth 1, Storage 0, Redis 0
- action `src/app/actions/files/nodes.ts#initializeProjectWorkspaceRoot` via `src/components/projects/v2/explorer/useExplorerBoot.ts#useExplorerBoot` — SQL 5, Auth 1, Storage 0, Redis 0
- action `src/app/actions/files/nodes.ts#findNodeByPathAny` via `src/components/projects/v2/files-tab/hooks/useDeepLinkResolver.ts#defaultLookup` — SQL 6, Auth 1, Storage 0, Redis 0

**Project · Sprints tab**

- action `src/app/actions/project/_all.ts#fetchProjectSprintTimelinePageAction` via `src/hooks/hub/useProjectTasksData.ts#useSprintDetail` — SQL 13, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 30, refetchOnWindowFocus=false
- action `src/app/actions/project/_all.ts#fetchProjectSprintDetailAction` via `src/hooks/hub/useProjectTasksData.ts#useSprintDetail` — SQL 11, Auth 1, Storage 0, Redis 0 (conditional) · staleTime=1000 * 30, refetchOnWindowFocus=false

**Project · Settings tab**

- action `src/app/actions/project/_all.ts#getProjectDangerZonePreflightAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 4, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/_all.ts#getProjectAccessImpactAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 6, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/_all.ts#getProjectCollaboratorSettingsAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 10, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/_all.ts#getProjectFileWorkspaceSettingsAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 2, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/_all.ts#readProjectNotificationSettingsAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 1, Auth 1, Storage 0, Redis 0
- action `src/app/actions/project/doc.ts#readProjectDocSettingsAction` via `src/components/projects/tabs/ProjectSettingsTab.tsx#default` — SQL 3, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/legal/acceptance/route.ts#GET` via `src/components/settings/LegalAndDataRightsSection.tsx#LegalAndDataRightsSection` — SQL 5, Auth 1, Storage 0, Redis 0
- API `src/app/api/v1/link-preview/route.ts#GET` via `src/hooks/useLinkPreview.ts#fetchLinkPreview` — SQL 3, Auth 1, Storage 0, Redis 4 (conditional)

## Final pre-implementation audit (v3)

### Removal ledger

| Bucket | Kind | Files | Lines |
|---|---|---:|---:|
| Dead source files (unreachable from any route, layout, proxy, worker or kept script) | App code | 53 | 6,060 |
| Tests that only cover those dead files | App code | 7 | 411 |
| Unused exported functions/constants inside live files (body lines) | App code | 159 | 3,217 |
| Unused exported types/interfaces | App code | 37 | 188 |
| Scale-readiness + retired-contract scripts | App code | 8 | 1,122 |
| ops/stability capacity/rollout JSON | App code | 5 | 432 |
| Feature-flag modules (all flags unset in production) | App code | 5 | 293 |
| No-op telemetry | App code | 2 | 415 |
| Load shedding | App code | 1 | 97 |
| Bloom filter for blocked pairs (16 users) | App code | 1 | 134 |
| Root middleware.ts (never built; merge ~100 lines of CSP/CSRF into proxy) | App code | 1 | 107 |
| Barrels and alias re-exports | App code | 7 | 166 |
| Unused AI completion route | App code | 1 | 108 |
| Hidden onboarding-preview route + harness | App code | 3 | 292 |
| next-intl config + messages (no consumers) | App code | 3 | 74 |
| theme-provider shrink (517 → ~120) | App code | 1 | 397 |
| Canonical-route wrapper files (replaced by the moved pages) | App code | 3 | 6 |
| Duplicate loading.tsx after the move (one per route kept) | App code | 3 | 7 |
| Read-replica split + fallbacks (no replica) | App code (estimate) | ~4 | 60 |
| Dead revalidatePath calls (redirect / non-route targets) | App code (estimate) | ~12 | 30 |
| Flag call-site false branches | App code (estimate) | ~18 | 180 |
| Generated client skill catalog | Generated | 1 | 22,473 |
| SVG sprite (4.1 MB) | Asset | 1 | 20,259 |
| Unused public/icon-* files | Asset | 22 | 0 |
| Vendored agent skills .agents/ | Vendored | 405 | 134,012 |
| Root scratch files | Repo clutter | 55 | 17,840 |
| scratch/ directory | Repo clutter | 101 | 8,722 |
| Extra lockfiles (pnpm-lock.yaml, bun.lock) | Repo clutter | 2 | 15,466 |
| Orphan migration drizzle/0152_message_preview_backfill.sql | SQL file | 1 | 12 |
| **Total App code** | | | **13,526** |
| **Total App code (estimate)** | | | **270** |
| **Total Generated** | | | **22,473** |
| **Total Asset** | | | **20,259** |
| **Total Vendored** | | | **134,012** |
| **Total Repo clutter** | | | **42,028** |
| **Total SQL file** | | | **12** |
| **Grand total** | | | **232,580** |

Optional: squash migration history (-57,608 lines, replaced by one baseline).

<details><summary>53 dead files</summary>

- `src/app/actions/files/events.ts` (153)
- `src/app/actions/files/gitActions.ts` (229)
- `src/app/actions/files/index.ts` (8)
- `src/app/actions/files/merge.ts` (61)
- `src/app/actions/files/search.ts` (158)
- `src/app/actions/git.ts` (36)
- `src/app/actions/people-applications.ts` (17)
- `src/app/api/v1/_rate-limits.ts` (68)
- `src/components/animate-ui/components/animate/avatar-group.tsx` (86)
- `src/components/animate-ui/components/radix/files.tsx` (157)
- `src/components/auth/OnboardingGuard.tsx` (11)
- `src/components/brand/BrandLoading.tsx` (115)
- `src/components/chat/index.ts` (3)
- `src/components/hub/BulkActionBar.tsx` (82)
- `src/components/hub/ProjectComparisonModal.tsx` (42)
- `src/components/layout/header/NavLink.tsx` (81)
- `src/components/onboarding/RadioCardGroup.tsx` (82)
- `src/components/people/ApplicationReviewModal.tsx` (63)
- `src/components/people/ProjectApplicationsSection.tsx` (205)
- `src/components/people/RequestsTab.tsx` (785)
- `src/components/profile/v2/sections/SkillsCard.tsx` (46)
- `src/components/projects/TabInfoComponents.tsx` (27)
- `src/components/projects/dashboard/TeamCard.tsx` (269)
- `src/components/projects/dashboard/index.ts` (3)
- `src/components/projects/doc/ProjectDocQuickConsole.tsx` (1195)
- `src/components/projects/doc/ProjectDocSwitcher.tsx` (69)
- `src/components/projects/intelligence/ProjectIntelligenceProvider.tsx` (66)
- `src/components/projects/tabs/ProjectPrivacyTermsTab.tsx` (117)
- `src/components/projects/v2/explorer/search.worker.ts` (125)
- `src/components/projects/v2/explorer/workerContracts.ts` (55)
- `src/components/settings/SecurityOverviewSection.tsx` (87)
- `src/hooks/useDeliveryAcks.ts` (22)
- `src/hooks/useScrollShadow.ts` (44)
- `src/i18n/routing.ts` (3)
- `src/lib/connections/social-proof.ts` (306)
- `src/lib/files/save-logic.ts` (23)
- `src/lib/github/analyze-repo.ts` (82)
- `src/lib/messages/search-document.ts` (18)
- `src/lib/messages/v2-render-state.ts` (42)
- `src/lib/projects/doc-settings.ts` (10)
- `src/lib/projects/doc-style.ts` (192)
- `src/lib/projects/task-file-note-sync.ts` (38)
- `src/lib/projects/task-file-presentation.ts` (321)
- `src/lib/realtime/refresh-reasons.ts` (18)
- `src/lib/security/json-ld.ts` (4)
- `src/lib/security/profile-visibility.ts` (14)
- `src/lib/services/index.ts` (8)
- `src/lib/stores/auth-store.ts` (72)
- `src/lib/ui/status-config.ts` (102)
- `src/lib/validations/files.ts` (46)
- `src/stores/files/selectors.ts` (44)
- `src/types/people.ts` (40)
- `src/workers/search.worker.ts` (110)

Tests that only cover them:

- `tests/unit/files-save-logic.test.ts` (28)
- `tests/unit/files-validation.test.ts` (119)
- `tests/unit/json-ld.test.ts` (15)
- `tests/unit/messages-v2-render-state.test.ts` (49)
- `tests/unit/status-config.test.ts` (25)
- `tests/unit/task-file-presentation.test.ts` (135)
- `tests/unit/task-files-explorer.test.ts` (40)
</details>

<details><summary>Unused exports</summary>

- `src/app/actions/account.ts:975` function `getAccountDataSummary` (~64 lines)
- `src/app/actions/account.ts:1047` function `getTransferableProjects` (~56 lines)
- `src/app/actions/applications/types.ts:85` type `ApplicationCursorPageInfo` (~4 lines)
- `src/app/actions/connections.ts:143` type `ConnectionRejectionReason` (~1 lines)
- `src/app/actions/files/_constants.ts:10` const `MAX_NODE_ACTIVITY_ITEMS` (~1 lines)
- `src/app/actions/files/_constants.ts:11` const `MAX_NODE_LINKED_TASKS` (~1 lines)
- `src/app/actions/files/_constants.ts:12` const `MAX_BATCH_REPLACE_FILES` (~1 lines)
- `src/app/actions/files/_constants.ts:13` const `MAX_BATCH_REPLACE_TOTAL_BYTES` (~1 lines)
- `src/app/actions/files/_constants.ts:72` function `countOccurrences` (~12 lines)
- `src/app/actions/files/_constants.ts:85` function `firstSnippet` (~10 lines)
- `src/app/actions/files/collections.ts:111` function `getTaskFileGroupPage` (~5 lines) (tests only)
- `src/app/actions/files/content.ts:176` function `getProjectFileSignedUrlBatch` (~44 lines) (tests only)
- `src/app/actions/files/content.ts:221` function `formatProjectFileContent` (~31 lines) (tests only)
- `src/app/actions/files/content.ts:298` function `updateProjectFileStatsSafe` (~17 lines)
- `src/app/actions/files/links.ts:310` function `updateTaskNodeLinksOrder` (~31 lines) (tests only)
- `src/app/actions/files/mutations.ts:891` function `trashNode` (~49 lines) (tests only)
- `src/app/actions/files/mutations.ts:1528` function `getSystemTasksFolderIdAction` (~20 lines)
- `src/app/actions/files/nodes.ts:318` function `getProjectNodesSafe` (~18 lines)
- `src/app/actions/files/nodes.ts:337` function `getProjectBatchNodes` (~83 lines)
- `src/app/actions/files/nodes.ts:445` function `getTaskWorkingFilesCollection` (~140 lines)
- `src/app/actions/files/nodes.ts:720` function `findNodeByPath` (~18 lines)
- `src/app/actions/files/nodes.ts:844` function `getProjectRecentNodes` (~23 lines)
- `src/app/actions/github-sync.ts:199` function `getGitHubSyncContributors` (~58 lines)
- `src/app/actions/messaging/features.ts:395` function `pruneOldMessageReceipts` (~22 lines) (tests only)
- `src/app/actions/notifications.ts:201` function `markAllNotificationsReadAction` (~28 lines) (tests only)
- `src/app/actions/notifications.ts:230` function `markConversationMessageNotificationsReadAction` (~20 lines) (tests only)
- `src/app/actions/notifications.ts:387` function `pauseNotificationsAction` (~25 lines)
- `src/app/actions/profile.ts:704` function `getProfileBasic` (~22 lines)
- `src/app/actions/project/_all.ts:6708` function `getProjectUserStateAction` (~50 lines)
- `src/app/actions/project/guidance.ts:129` function `getProjectGuidanceDisplayAction` (~44 lines) (tests only)
- `src/app/actions/project/guidance.ts:215` function `renameProjectGuidanceLabelAction` (~33 lines)
- `src/app/actions/project/guidance.ts:249` function `setProjectGuidanceAttributionConsentAction` (~15 lines)
- `src/app/actions/project/guidance.ts:265` function `endProjectGuidanceAppointmentAction` (~17 lines)
- `src/app/actions/subtask.ts:169` function `reorderSubtasksAction` (~28 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:5` type `ApplicationWorkflowAction` (~1 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:43` type `StructuredActionOption` (~1 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:45` const `GUIDED_FIRST_CONTACT_TEMPLATES` (~5 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:51` type `SlashMenuItem` (~9 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:86` const `EMPTY_STRUCTURED_ACTION_DRAFT` (~16 lines)
- `src/components/chat/v2/message-composer-v2-shared.ts:103` function `dedupeContextChips` (~11 lines)
- `src/components/profile/v2/types.ts:54` interface `ProfileViewModel` (~10 lines)
- `src/components/projects/ProjectAvatar.tsx:87` function `getProjectPresenceState` (~6 lines) (tests only)
- `src/components/projects/ProjectAvatar.tsx:97` function `broadcastProjectActivity` (~14 lines) (tests only)
- `src/components/projects/tabs/SprintPlanning.tsx:54` type `SprintTask` (~1 lines)
- `src/components/projects/v2/explorer/explorerTypes.ts:12` type `ExplorerProps` (~13 lines)
- `src/components/projects/v2/explorer/explorerTypes.ts:33` function `areIdListsEqual` (~7 lines)
- `src/components/projects/v2/explorer/explorerTypes.ts:50` const `EXPLORER_RUNTIME_BUDGETS` (~1 lines)
- `src/components/projects/v2/explorer/utils/buildVisibleRows.ts:57` function `__clearBuildVisibleRowsCacheForTests` (~3 lines) (tests only)
- `src/components/projects/v2/files-tab/hooks/useFilesTabUrlSync.ts:183` function `shouldPreserveTaskFileDeepLink` (~24 lines) (tests only)
- `src/components/projects/v2/files-tab/sidebarSearch.ts:20` const `FILES_TAB_SIDEBAR_HEADER_HEIGHT_PX` (~1 lines)
- `src/components/projects/v2/files-tab/sidebarSearch.ts:23` const `FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS` (~1 lines) (tests only)
- `src/constants/hub.ts:44` type `ViewMode` (~1 lines)
- `src/constants/project-wizard.ts:18` const `PHASE_LABELS` (~4 lines)
- `src/constants/routes.ts:34` const `API_ROUTES` (~1 lines)
- `src/hooks/hub/useProjectDocData.ts:20` const `PROJECT_DOC_IMPORT_CANDIDATES_QUERY_KEY` (~2 lines)
- `src/hooks/hub/useProjectDocData.ts:39` function `useProjectDocSettings` (~14 lines)
- `src/hooks/hub/useProjectDocData.ts:54` function `useProjectDocReferenceOptions` (~14 lines)
- `src/hooks/useConnections.ts:175` type `RequestHistoryData` (~4 lines)
- `src/hooks/useConnections.ts:477` function `useRequestHistory` (~16 lines)
- `src/hooks/useMessagesV2.ts:381` function `useMessagingStructuredCatalog` (~18 lines)
- `src/hooks/useNotifications.ts:128` function `useNotificationUnreadCount` (~17 lines)
- `src/hooks/useTaskFileMutations.ts:38` type `TaskFilePendingResolution` (~1 lines)
- `src/hooks/useUsernameAvailability.ts:55` function `resetUsernameAvailabilityCache` (~4 lines) (tests only)
- `src/lib/applications/reasons.ts:15` const `APPLICATION_REJECTION_REASON_OPTIONS` (~10 lines)
- `src/lib/applications/reasons.ts:48` function `getApplicationDecisionReasonLabel` (~20 lines)
- `src/lib/applications/status.ts:26` function `isApplicationLifecycleStatus` (~3 lines)
- `src/lib/auth/account-identity.ts:58` function `formatProviderLabel` (~14 lines)
- `src/lib/connections/internal-helpers.ts:9` function `applyConnectionsCountIncrements` (~19 lines)
- `src/lib/connections/internal-helpers.ts:78` function `syncConnectionsToRedis` (~33 lines) (tests only)
- `src/lib/data/project-access.ts:140` const `getProjectAccessBySlug` (~5 lines)
- `src/lib/extension/observability.ts:31` function `withExtensionTiming` (~24 lines)
- `src/lib/extension/recovery-session-state.ts:1` const `RECOVERY_SESSION_HEARTBEAT_MS` (~1 lines)
- `src/lib/features/messages.ts:40` const `messagesFeatureFlags` (~7 lines) (tests only)
- `src/lib/features/messages.ts:48` const `messagesRolloutPercents` (~7 lines) (tests only)
- `src/lib/features/messages.ts:70` function `isMessagesV2Enabled` (~3 lines)
- `src/lib/features/messages.ts:86` function `isMessagingGuidedFirstContactEnabled` (~3 lines) (tests only)
- `src/lib/files/content-hash.ts:132` function `compareContentHashes` (~9 lines)
- `src/lib/files/file-lock-service.ts:11` const `FILE_LEASE_HEARTBEAT_MS` (~1 lines)
- `src/lib/files/folder-drop.ts:225` function `topLevelChildNames` (~5 lines)
- `src/lib/files/internal-helpers.ts:18` function `assertProjectAccess` (~3 lines)
- `src/lib/files/observability.ts:34` function `createFilesCorrelationId` (~3 lines)
- `src/lib/github/worker-guard.ts:62` function `assertRepositoryWithinBudgets` (~53 lines)
- `src/lib/import/utils.ts:162` function `scanFiles` (~7 lines)
- `src/lib/import/utils.ts:280` function `createDirectoryStructure` (~20 lines)
- `src/lib/import/utils.ts:304` function `uploadToStorageAndDB` (~135 lines)
- `src/lib/import/utils.ts:440` function `createDirectoryStructureFromRoot` (~12 lines) (tests only)
- `src/lib/import/utils.ts:453` function `uploadRepoFiles` (~200 lines) (tests only)
- `src/lib/legal/acceptance.ts:45` function `clearCachedLegalAcceptance` (~5 lines)
- `src/lib/messages/attention.ts:96` function `extractMessageBurstConversationId` (~8 lines) (tests only)
- `src/lib/messages/reactions.ts:163` function `toPersistedReactionSummary` (~8 lines) (tests only)
- `src/lib/messages/structured.ts:37` type `MessageWorkflowItemScope` (~1 lines)
- `src/lib/messages/structured.ts:602` function `getPrivateFollowUpFromMetadata` (~27 lines) (tests only)
- `src/lib/messages/thread-items.ts:132` function `buildMessageThreadItems` (~5 lines)
- `src/lib/notifications/cache.ts:138` function `markAllNotificationsReadInInfiniteData` (~17 lines) (tests only)
- `src/lib/notifications/classifier.ts:24` function `classifyNotificationKind` (~3 lines) (tests only)
- `src/lib/notifications/classifier.ts:32` function `isActionRequiredKind` (~3 lines) (tests only)
- `src/lib/notifications/classifier.ts:36` const `J1_NOTIFICATION_KINDS` (~1 lines) (tests only)
- `src/lib/notifications/emitters.ts:234` function `emitApplicationReceivedNotification` (~34 lines)
- `src/lib/notifications/emitters.ts:269` function `emitApplicationDecisionNotification` (~40 lines)
- `src/lib/notifications/emitters.ts:368` function `emitTaskAssignedNotification` (~38 lines)
- `src/lib/notifications/emitters.ts:407` function `emitTaskStatusAttentionNotification` (~40 lines)
- `src/lib/notifications/emitters.ts:448` function `emitTaskCommentMentionNotification` (~41 lines)
- `src/lib/notifications/emitters.ts:490` function `emitTaskCommentReplyNotification` (~41 lines) (tests only)
- `src/lib/notifications/emitters.ts:532` function `emitTaskFileNotification` (~55 lines) (tests only)
- `src/lib/notifications/emitters.ts:588` function `emitFileVersionAddedNotification` (~43 lines)
- `src/lib/notifications/emitters.ts:632` function `emitProjectRoleChangedNotification` (~39 lines)
- `src/lib/notifications/emitters.ts:672` function `emitProjectMemberRemovedNotification` (~37 lines)
- `src/lib/notifications/emitters.ts:710` function `emitProjectOwnershipTransferredNotification` (~38 lines)
- `src/lib/notifications/presentation.ts:278` function `resolveMuteScope` (~3 lines)
- `src/lib/notifications/presentation.ts:377` const `shouldSuppressToast` (~1 lines)
- `src/lib/notifications/service.ts:160` function `shouldDelayNotification` (~3 lines)
- `src/lib/notifications/task-comment-mention.ts:4` interface `TaskCommentMentionNotificationPayload` (~13 lines)
- `src/lib/onboarding/config.ts:3` const `ONBOARDING_VARIANT` (~13 lines)
- `src/lib/onboarding/contracts.ts:22` type `OnboardingPayloadContract` (~19 lines)
- `src/lib/onboarding/events.ts:24` type `OnboardingEventType` (~7 lines)
- `src/lib/onboarding/events.ts:44` function `normalizeOnboardingEventInput` (~3 lines)
- `src/lib/onboarding/state.ts:9` type `OnboardingProgress` (~7 lines)
- `src/lib/onboarding/step-ui-config.ts:49` const `STEP_TRANSITION` (~6 lines)
- `src/lib/privacy/bloom-filter.ts:50` function `isBlockedPair` (~12 lines)
- `src/lib/privacy/bloom-filter.ts:83` function `rebuildBlockedPairsSet` (~52 lines)
- `src/lib/privacy/presentation.ts:137` function `getPrivacyLockedShellLabel` (~3 lines)
- `src/lib/privacy/presentation.ts:141` function `getPrivacyBlockedMessage` (~3 lines)
- `src/lib/profile/display.ts:33` function `countLabel` (~3 lines)
- `src/lib/profile/domain-presence.ts:44` type `SectorIconKey` (~1 lines)
- `src/lib/profile/normalization.ts:97` const `SOCIAL_LINK_PLATFORM_OPTIONS` (~1 lines)
- `src/lib/profile/normalization.ts:292` function `isStaleSocialLinkStatus` (~3 lines) (tests only)
- `src/lib/profile/normalization.ts:500` function `validateSocialLinkRecord` (~2 lines) (tests only)
- `src/lib/profile/role-preferences.ts:21` type `ProfileExperienceLevel` (~34 lines)
- `src/lib/profile/role-preferences.ts:31` type `WeeklyCapacity` (~24 lines)
- `src/lib/profile/role-preferences.ts:107` function `hasRolePreferences` (~9 lines)
- `src/lib/projects/doc-blocks.ts:126` function `buildInlineReadmeReference` (~3 lines) (tests only)
- `src/lib/projects/doc-create-intent.ts:5` type `ProjectDocCreationIntent` (~6 lines)
- `src/lib/projects/doc-create-intent.ts:41` function `findBestReadmeCandidate` (~24 lines)
- `src/lib/projects/doc-editor-source-map.ts:77` function `getDocLineStartOffset` (~12 lines) (tests only)
- `src/lib/projects/doc-editor-source-map.ts:153` function `buildProjectDocEditorSourceTargets` (~66 lines) (tests only)
- `src/lib/projects/doc-editor-source-map.ts:220` function `findProjectDocEditorSourceTarget` (~16 lines) (tests only)
- `src/lib/projects/doc-media.ts:17` type `ProjectDocImageSourceKind` (~1 lines)
- `src/lib/projects/doc-media.ts:131` function `buildProjectDocImageMarkdown` (~43 lines) (tests only)
- `src/lib/projects/doc-navigation.ts:1` type `ProjectDocTargetKind` (~1 lines)
- `src/lib/projects/doc-navigation.ts:3` const `PROJECT_DOC_TARGET_SELECTOR` (~1 lines)
- `src/lib/projects/doc-navigation.ts:36` function `buildProjectDocCommandBlockTargetMaps` (~18 lines)
- `src/lib/projects/doc-quick-console.ts:693` function `buildProjectDocQuickConsoleSummary` (~16 lines)
- `src/lib/projects/doc.ts:65` type `ProjectDoc` (~11 lines)
- `src/lib/projects/doc.ts:237` function `resolveProjectDocCollaborationContent` (~45 lines) (tests only)
- `src/lib/projects/mention-tokens.ts:146` function `extractMentionIds` (~3 lines) (tests only)
- `src/lib/projects/mention-tokens.ts:155` function `serializeSegments` (~14 lines) (tests only)
- `src/lib/projects/mention-tokens.ts:170` function `isValidUserId` (~3 lines) (tests only)
- `src/lib/projects/project-create-options.ts:19` type `ProjectTypeId` (~1 lines)
- `src/lib/projects/project-create-options.ts:36` const `POPULAR_PROJECT_TECH` (~12 lines) (tests only)
- `src/lib/projects/project-invitations.ts:26` type `ProjectInvitationStatus` (~1 lines)
- `src/lib/projects/sprint-detail.ts:267` function `pluralizeSprintUnit` (~3 lines)
- `src/lib/projects/sprint-detail.ts:314` function `buildProjectSprintTabHref` (~3 lines) (tests only)
- `src/lib/projects/sprint-presentation.ts:16` function `formatSprintTaskSummary` (~7 lines) (tests only)
- `src/lib/projects/sprint-timeline.ts:34` const `compareSprintTimelineActivityRows` (~1 lines)
- `src/lib/projects/sprints.ts:206` type `DeleteSprintInput` (~1 lines)
- `src/lib/projects/task-cache.ts:190` function `findTaskInProjectTaskCaches` (~29 lines)
- `src/lib/projects/task-discussion.ts:45` type `TaskDiscussionTypingContext` (~4 lines)
- `src/lib/projects/task-discussion.ts:65` function `isTaskDiscussionCommentDeleted` (~3 lines)
- `src/lib/projects/task-draft.ts:66` function `buildTaskEditorDraft` (~44 lines) (tests only)
- `src/lib/projects/task-workflow.ts:98` const `TASK_BOARD_COLUMNS` (~13 lines) (tests only)
- `src/lib/projects/updates.ts:20` const `PROJECT_UPDATE_TYPE_LABELS` (~9 lines) (tests only)
- `src/lib/projects/updates.ts:30` const `PROJECT_UPDATE_FILTERS` (~1 lines) (tests only)
- `src/lib/realtime/doc-collaboration-document.ts:20` function `isDocCollaborationDocumentName` (~3 lines)
- `src/lib/realtime/doc-collaboration-token.ts:89` function `verifyDocCollaborationToken` (~52 lines)
- `src/lib/realtime/presence-client.ts:554` function `getPresenceRoomCountForTests` (~3 lines)
- `src/lib/realtime/presence-client.ts:558` function `resetPresenceClientForTests` (~7 lines)
- `src/lib/security/path-safety.ts:16` function `sanitizePathSegment` (~5 lines)
- `src/lib/security/path-safety.ts:49` function `resolvePathUnderRoot` (~13 lines) (tests only)
- `src/lib/security/step-up.ts:124` function `clearSecurityStepUpCookie` (~9 lines)
- `src/lib/security/urls.ts:139` function `sanitizeOptionalHttpUrl` (~7 lines)
- `src/lib/skills/catalog.ts:605` const `CORE_SKILLS` (~1 lines)
- `src/lib/standards/impact-review.ts:59` type `ImpactReviewRuntimePlane` (~1 lines)
- `src/lib/standards/impact-review.ts:60` type `ImpactReviewCanonicalDomain` (~1 lines)
- `src/lib/standards/impact-review.ts:61` type `ImpactReviewRiskLevel` (~1 lines)
- `src/lib/standards/sql-governance.ts:27` type `SqlChangeKind` (~1 lines)
- `src/lib/standards/sql-governance.ts:28` type `SqlGovernanceException` (~1 lines)
- `src/lib/storage/project-file-key.ts:83` function `toCanonicalProjectFileKey` (~5 lines) (tests only)
- `src/lib/supabase/server.ts:147` const `createSupabaseServerClient` (~16 lines)
- `src/lib/upload/image-prep-client.ts:71` function `prepareImageForUpload` (~51 lines)
- `src/lib/upload/image-prep-client.ts:158` function `prepareCoverImageForUpload` (~90 lines) (tests only)
- `src/lib/upload/upload-intents.ts:15` type `UploadIntentStatus` (~1 lines)
- `src/lib/usernames/service.ts:190` function `ensureUsernameClaimable` (~11 lines)
- `src/lib/utils/date.ts:5` function `toRequiredIsoString` (~3 lines)
- `src/lib/validations/messaging.ts:7` const `sendMessageSchema` (~6 lines) (tests only)
- `src/lib/validations/project.ts:27` type `CreatorRoleInput` (~1 lines)
- `src/lib/validations/project.ts:81` type `ProjectDocCreationIntentInput` (~1 lines)
- `src/lib/validations/task.ts:47` type `CreateTaskInput` (~1 lines)
- `src/lib/validations/task.ts:48` type `UpdateTaskFieldInput` (~1 lines)
- `src/lib/validations/username.ts:39` function `isReservedUsername` (~4 lines) (tests only)
- `src/lib/workspace/counter-logic.ts:30` function `isWorkspaceTaskOverdue` (~7 lines) (tests only)
- `src/lib/workspace/counter-logic.ts:38` function `isWorkspaceTaskDueToday` (~11 lines) (tests only)
- `src/stores/files/contentMap.ts:132` function `persistDirtyContent` (~21 lines)
- `src/stores/files/contentMap.ts:155` function `clearDirtyContent` (~17 lines)
- `src/stores/files/contentMap.ts:174` function `recoverDirtyContent` (~36 lines)
- `src/stores/files/explorerSlice.ts:80` function `evictLruIfNeeded` (~33 lines)
- `src/stores/files/explorerSlice.ts:175` function `estimateVisibleRowsBudget` (~14 lines)
</details>

### Rename map

227 symbol references, 108 route literals in 43 files, 91 import paths in 52 files, 11 query keys.

| From | To | Notes |
|---|---|---|
| `src/app/(main)/hub/page.tsx` | `src/app/(main)/discover/page.tsx` | replace 2-line wrapper; delete hub/loading.tsx (re-export) |
| `src/app/(main)/people/page.tsx` | `src/app/(main)/network/page.tsx` | replace wrapper; delete people/loading.tsx |
| `src/app/(main)/profile/page.tsx + loading.tsx` | `src/app/(main)/my-profile/` | replace wrapper; my-profile/loading.tsx already exists, delete profile/loading.tsx |
| `src/components/hub/` | `src/components/discover/` | SimpleHubClient→DiscoverClient, HubHeader→DiscoverHeader, HubRouteSkeleton→DiscoverRouteSkeleton, HubErrorBoundary→DiscoverErrorBoundary; DiscoverPeopleRail keeps its name; BulkActionBar + ProjectComparisonModal deleted (dead) |
| `src/components/people/` | `src/components/network/` | PeopleHubClient→NetworkClient, PeopleClient→NetworkPeopleTab; ConnectionsClient, InvitationsClient, NetworkRouteSkeleton, PersonCard* keep names; RequestsTab, ProjectApplicationsSection, ApplicationReviewModal deleted (dead) |
| `src/hooks/hub/useHub*.ts` | `src/hooks/discover/useDiscover*.ts` | useHubProjectsSimple→useDiscoverProjects, useHubSessionSeen→useDiscoverSessionSeen, useHubUrlFilters→useDiscoverUrlFilters |
| `src/hooks/hub/useProject*.ts, useUserInteractions.ts` | `src/hooks/projects/` | not Discover code (RT-08) |
| `src/lib/hub/` | `src/lib/discover/` | observability.ts, ranking-config.ts, snapshot-cache.ts |
| `src/lib/data/hub.ts` | `src/lib/data/discover.ts` |  |
| `src/constants/hub.ts` | `src/constants/discover.ts` |  |
| `src/types/hub.ts` | `src/types/discover.ts` | src/types/people.ts deleted (dead) |
| `src/app/actions/hub.ts` | `src/app/actions/discover.ts` | src/app/actions/people-applications.ts deleted (dead) |
| `src/lib/view-models/hub-user.ts` | `src/lib/view-models/discover-user.ts` |  |
| `src/components/providers/PeopleNotificationsProvider.tsx` | `…/NetworkNotificationsProvider.tsx` |  |
| `src/hooks/usePeopleNotifications.ts` | `src/hooks/useNetworkNotifications.ts` |  |
| `public/og/hub-card.{png,svg}` | `public/og/discover-card.{png,svg}` | update buildRouteMetadata image path |
| `tests/e2e/hub-cursor-integrity.spec.ts, tests/unit/hub-pagination.test.ts` | `discover-*` | hub-canonical-contract.test.ts deleted with its script |
| `tests/e2e/people-matrix.spec.ts, tests/unit/people-notifications-provider.test.ts` | `network-*` |  |

| Symbol | New name | Refs | Files |
|---|---|---:|---:|
| `SimpleHubClient` | `DiscoverClient` | 17 | 8 |
| `HubHeader` | `DiscoverHeader` | 9 | 4 |
| `HubRouteSkeleton` | `DiscoverRouteSkeleton` | 9 | 4 |
| `HubErrorBoundary` | `DiscoverErrorBoundary` | 5 | 2 |
| `HubFilters` | `DiscoverFilters` | 16 | 5 |
| `InvalidHubCursorError` | `InvalidDiscoverCursorError` | 14 | 4 |
| `HUB_RANKING_SCHEMA_VERSION` | `DISCOVER_RANKING_SCHEMA_VERSION` | 12 | 3 |
| `getHubRankingWeights` | `getDiscoverRankingWeights` | 10 | 2 |
| `HubRankingWeights` | `DiscoverRankingWeights` | 7 | 1 |
| `getHubProjects` | `getDiscoverProjects` | 6 | 2 |
| `buildHubSnapshotKey` | `buildDiscoverSnapshotKey` | 6 | 3 |
| `mapPublicProjectToHubProject` | `mapPublicProjectToDiscoverProject` | 7 | 4 |
| `fetchHubProjectsAction` | `fetchDiscoverProjectsAction` | 6 | 4 |
| `recordHubMetric` | `recordDiscoverMetric` | 4 | 2 |
| `HubMetricEvent` | `DiscoverMetricEvent` | 2 | 1 |
| `HubUser` | `DiscoverUser` | 3 | 1 |
| `toHubUser` | `toDiscoverUser` | 3 | 2 |
| `getHubSnapshotCached` | `getDiscoverSnapshotCached` | 3 | 2 |
| `clearHubSnapshotCache` | `clearDiscoverSnapshotCache` | 3 | 2 |
| `parseHubCursor` | `parseDiscoverCursor` | 2 | 1 |
| `getCachedAnonymousHubPage` | `getCachedAnonymousDiscoverPage` | 2 | 1 |
| `HubQueryOptions` | `DiscoverQueryOptions` | 2 | 1 |
| `useHubProjectsSimple` | `useDiscoverProjects` | 4 | 2 |
| `useHubSessionSeen` | `useDiscoverSessionSeen` | 4 | 2 |
| `useHubUrlFilters` | `useDiscoverUrlFilters` | 4 | 2 |
| `HubProject` | `DiscoverProject` | 0 | 0 |
| `PeopleHubClient` | `NetworkClient` | 7 | 5 |
| `PeopleClient` | `NetworkPeopleTab` | 8 | 5 |
| `PeopleNotificationsProvider` | `NetworkNotificationsProvider` | 9 | 6 |
| `PeopleNotificationsContext` | `NetworkNotificationsContext` | 4 | 1 |
| `usePeopleNotifications` | `useNetworkNotifications` | 21 | 8 |
| `usePeopleNotificationsContext` | `useNetworkNotificationsContext` | 3 | 2 |
| `readPeoplePendingCountsAction` | `readNetworkPendingCountsAction` | 5 | 3 |
| `PeopleSearchScope` | `NetworkSearchScope` | 6 | 2 |
| `getPeopleSearchScope` | `getNetworkSearchScope` | 4 | 2 |

- Route strings: replace `/hub`, `/people`, `/profile` literals with `/discover`, `/network`, `/my-profile` (108 in 43 files, incl. `route-class.ts`, `page-contract.ts`, `proxy.ts`, `auth/callback`). Keep the three 308 redirects in `next.config.ts` for old links.
- `ROUTES`: delete alias keys `HUB`, `PEOPLE`, `PROFILE`; keep `DISCOVER`, `NETWORK`, `MY_PROFILE`.
- Query keys: `queryKeys.hub.*` (11 keys) → `queryKeys.discover.*`; the query-key contract script follows.
- Browser storage keys `hub:create-project-modal-state`, `hub.view`, `hub:projects` → `discover:*`. Renaming drops users' saved UI state once; acceptable, no fallback code.
- Metric/log names `hub.snapshot.*` → `discover.snapshot.*`.
- Keep the `connections` domain (table, actions, `ConnectionsClient`): it names the entity, not the page.
- Leave `/u/[username]` and `components/profile/*` as is: they are the profile feature, not the legacy route.
- No SQL object uses hub/people naming, so the page rename needs no migration.

### SQL plan

Live inventory: 101 tables (13 partitions), 559 indexes, 164 policies, 26 functions, 34 triggers, 2 views, 10 enums, 6 buckets.

- **Rename 56 indexes:** 42 `idx_<t>_<c>` → `<t>_<c>_idx`; 7 `*_uidx` → `*_unique`; 3 `*_pk` → `*_pkey`; `project_git_deltas_unique_seq` → `project_git_deltas_seq_unique`; `conversation_participants_last_reaction_message_conversation_id` → `…_last_reaction_message_idx`. Verified: 0 name collisions. 4 are constraint-backed → `ALTER TABLE … RENAME CONSTRAINT`, the rest `ALTER INDEX … RENAME TO`. `ALTER INDEX idx_tasks_sprint_id RENAME TO tasks_sprint_id_idx;`
- **Unique naming:** `extension_device_sessions_token_hash_key`, `extension_recovery_drafts_storage_key_key` → `*_unique`. Drop `dm_pairs_user_low_high_unique` (identical to `dm_pairs_user_low_user_high_key`). `DROP INDEX dm_pairs_user_low_high_unique;`
- **Rename 114 policies:** Rule `<table>_<command>_<scope>` with scope own / visible / project_writer / project_admin / project_member / author / author_or_admin. Generated in SQL from `pg_policies`: 114 names, all distinct, 0 collisions. Example: "Users can view own connections" → `connections_select_own`. `ALTER POLICY "Users can view own connections" ON connections RENAME TO connections_select_own;`
- **Rename 4 triggers:** `trg_messages_after_insert_consistency` → `messages_insert_consistency`; `trigger_sync_project_open_roles_count` → `project_open_roles_sync_count`; `tr_sync_profile_to_auth_user_metadata` → `profiles_sync_auth_metadata`; `trg_prevent_readme_delete` → `project_docs_prevent_delete`. `ALTER TRIGGER trg_prevent_readme_delete ON project_markdowns RENAME TO project_docs_prevent_delete;`
- **Docs domain:** Tables `project_markdowns`, `project_markdown_versions`, `project_markdown_assets`, `project_markdown_draft_contributors` → `project_docs`, `project_doc_versions`, `project_doc_assets`, `project_doc_draft_contributors`; enum `status_readme_asset` → `status_doc_asset`; functions `prevent_readme_delete`, `app_private.nb_readme_version_is_public`, `nb_readme_asset_is_public`, `nb_project_public_readme_visible` → `*doc*`. Policies/triggers bind by OID, so they keep working. Code: 156 Drizzle refs in ~15 files (`projectMarkdowns*`). `ALTER TABLE project_markdowns RENAME TO project_docs;`
- **Enum:** `status_role_app` → `status_role_application`. `ALTER TYPE status_role_app RENAME TO status_role_application;`
- **Drop unused:** Tables `collection_projects`, `saved_projects`, `skill_popularity_snapshots`, `profile_interests` (+ their 8 policies, indexes); view `onboarding_funnel_dimensions_daily`; function `app_private.nb_validate_dm_conversation`; publication entries per DB-01. `DROP TABLE saved_projects, collection_projects, skill_popularity_snapshots, profile_interests;`
- **Collapse partitions:** `project_node_events` 13 partitions → one table; drop `create_future_partitions()` + 13 per-partition triggers (DB-25). `CREATE TABLE project_node_events_new (LIKE project_node_events INCLUDING ALL); …`
- **Security:** `REVOKE EXECUTE ON FUNCTION sync_profile_to_auth_user_metadata() FROM anon, authenticated`; `SET search_path = ''` on it and `seed_project_workflow_columns` (DB-17).
- **Migration files:** Delete orphan `drizzle/0152_message_preview_backfill.sql` and empty `supabase/migrations/`. Squash optional (DEAD-08).

### Scale mechanisms

keep 13 · cut 7 · simplify 9 · rewrite 1

| Mechanism | Where | Verdict | Rewritten marker |
|---|---|---|---|
| Global load shedding (Redis token bucket) | lib/routing/load-shedding.ts, proxy | cut | — |
| Rate limit on liveness/readiness probes | api/v1/live, api/v1/ready | cut | — |
| Per-route rate limits on authenticated reads | ~40 of 73 `enforceRouteLimit` calls (projects, sessions, privacy, skills, profiles, integrations, appearance, files) | simplify | ponytail: no Redis limit on authenticated reads. ceiling: per-user abuse by a signed-in account. upgrade: add back per route when logs show >10 req/s from one user. |
| Rate limits on abuse surfaces | auth/*, signup, username-check, link-preview, extension auth-code, webhooks, GitHub import, CSRF | keep | ponytail: Upstash sliding window per IP/user. ceiling: one region Redis. upgrade: none needed below ~1k rps. |
| RATE_LIMIT_MODE (distributed-only / best-effort) | lib/security/rate-limit.ts (462 lines) | simplify | ponytail: one mode, fail-closed (only abuse surfaces keep limits). ceiling: Redis outage blocks sign-in. upgrade: fail-open mode if that ever happens. |
| DB pool (transaction pooler forced, idle 10 s, max 20) | lib/db/index.ts | rewrite | ponytail: session pooler, max 10, idle 300 s, fetch_types off. ceiling: one long-lived server. upgrade: transaction pooler + max 2 if moved to serverless. |
| Read replica split (readDb/db) | lib/db/index.ts + fallbacks | cut | — |
| Statement / idle-tx timeouts (8 s / 5 s) | lib/db/index.ts | keep | ponytail: 8 s statement cap. ceiling: slow report queries fail. upgrade: per-query SET LOCAL for known long jobs. |
| Monthly partitions on project_node_events | 13 partitions, trigger each, create_future_partitions(), monthly cron | cut | ponytail: one table. ceiling: ~10 M rows. upgrade: partition when retention deletes get slow. |
| Realtime publication (21 tables) | supabase_realtime | simplify | ponytail: publish only the 16 subscribed tables. ceiling: Realtime ≤50% of DB time. upgrade: Broadcast for per-user feeds. |
| Realtime channel budget (4) / presence rooms (3) | project-files-channel.ts, useOnlineUsers.ts | keep | ponytail: hard client caps. ceiling: 4 channels/tab. upgrade: raise when a view needs more. |
| Three presence mechanisms | 10-min heartbeat POST + Realtime Presence + profiles.last_active_at writes | simplify | ponytail: Realtime Presence for online; throttled last_active_at (5 min) for 'last seen'. ceiling: last-seen accurate to 5 min. upgrade: none. |
| Denormalized counters twice (profiles + profile_counters) + 2 reconcile crons | workspace-counter-reconcile, workspace-counter-refresh | simplify | ponytail: counters only in profile_counters, one nightly reconcile. ceiling: drift ≤24 h if a write path misses. upgrade: trigger-maintained counts. |
| View/like counters via Redis + 15-min flush (write-through also on) | flush-views, flush-likes, PROJECT_VIEWS_WRITE_THROUGH | simplify | ponytail: unset write-through; Redis + flush only. ceiling: counts lag ≤15 min. upgrade: none. |
| Precomputed social-graph suggestions + collaboration summaries | connection_suggestions (+cron), profile_collaboration_summaries (20 rows) | keep (flag) | ponytail: precompute kept since it exists and works. ceiling: cron cost grows with users². upgrade: compute on read if it is ever cheaper, re-check at 10k users. |
| Discover snapshot cache (300 entries) + ranking weights env + schema version | lib/hub/snapshot-cache.ts, ranking-config.ts | simplify | ponytail: one indexed query per page, no snapshot cache, weights as constants. ceiling: ~10k public projects. upgrade: bring back a cache when the feed query >100 ms. |
| Process-global in-flight dedupe | lib/utils/inflight-dedupe.ts, 33 call sites | simplify | ponytail: React cache() per request only. ceiling: identical concurrent requests hit the DB twice. upgrade: dedupe the one hot path that shows up in pg_stat_statements. |
| 37 module-level Map caches | GitHub tokens/health, JWKS, legal acceptance, extension sessions, doc view-model/quality/source-map caches, signed-URL cache… | keep | ponytail: plain Maps, no caps. ceiling: memory flat at 252–299 MB for 7 days. upgrade: size cap on the doc caches only if memory climbs. |
| Bloom filter for blocked pairs | lib/privacy/bloom-filter.ts (134 lines) | cut | ponytail: Set of blocked ids per viewer from one query. ceiling: ~10k blocks per user. upgrade: bloom filter if that query shows up. |
| Hardening rollout percentages | lib/features/hardening.ts (16 env + % knobs) | cut | — |
| 1M-readiness / capacity / rollout / load-suite / stability scripts | 8 scripts, ops/stability/*.json | cut | ponytail: no load tooling. ceiling: current traffic (3.9k req/week). upgrade: one k6 script when traffic passes 100 rps. |
| GitHub import budgets (files, dirs, bytes, timeouts) | lib/github/worker-guard.ts, env defaults | keep | ponytail: hard budgets protect worker memory. ceiling: repos above the budget are refused. upgrade: streaming import. |
| Upload size limits | attachments, profile images, project files | keep | — |
| Inngest concurrency limits (13) | inngest/functions/* | keep | — |
| Advisory locks (16) | files, sync, sprints | keep | correctness, not scale |
| 22 cron functions (8 at ≤15 min) | inngest/functions/* | simplify | ponytail: hourly for sweeps, daily for retention. ceiling: cleanup lags ≤1 h. upgrade: event triggers for the ones users wait on. |
| Separate worker service | Railway networkbase-worker (INNGEST_EXECUTION_ROLE) | keep | ponytail: worker isolates GitHub imports from web memory. ceiling: 2 services to run. upgrade: merge if imports move to streaming. |
| Virtualized lists (react-virtuoso) | 12 views | keep | — |
| Pagination caps and cursors | feeds, files (200-item selection), messages | keep | — |
| CDN / immutable asset caching | next.config.ts headers, images 31-day TTL | keep | — |

## Fix these first

- **INF-01** Web origin runs in Amsterdam; edge, DB and Auth are in Singapore
- **DB-01** Realtime `postgres_changes` WAL polling uses 89% of all DB time
- **DB-02** Connection churn: 117k type fetches, 500k pooler auths
- **MW-01** Two middleware files; the one with CSP/CSRF never runs on `main`
- **FE-04** Tailwind scans the whole repo → 431 KB render-blocking CSS
- **RSC-07** Server actions used as GET data loaders in 51 client files
- **FE-01** ~1 MB client JS baseline on every page, including static ones
- **RT-01** Three pages have two names each

## Measurements

| Probe | Result |
|---|---|
| Railway web, 7 days | p50 6–168 ms · p90 161–2,044 ms · p95 up to 2,882 ms · p99 up to 3,948 ms |
| Status mix, 7 days | 2xx 1,920 · 3xx 400 · 4xx 1,594 · 5xx 0 (3,914 requests) |
| Web memory / CPU | 252–299 MB of 1 GB, flat (no leak) · CPU ≈ 0 of 2 vCPU |
| Worker memory / CPU | 140–162 MB · CPU ≈ 0.2% |
| GET / (anon) | 307 → /login, TTFB 618–842 ms |
| GET /login | TTFB 777 ms (server 562 ms) · DCL 1.30 s · load 2.38 s · 18 JS 295 KB br / 1,000 KB decoded · CSS 53 KB br / 371 KB · CLS 0 · long tasks 0 |
| GET /terms | TTFB 353 ms · DCL 583 ms · load 752 ms · 15 JS / 735 KB decoded · 72 KB HTML + 43 KB RSC · no-store |
| GET /api/v1/live | TTFB 622–739 ms (no DB) — edge→Amsterdam hop |
| GET /api/v1/health | TTFB 885–2,107 ms (DB check) |
| Protocol / compression | HTTP/2 (Cloudflare) · Brotli · static assets immutable 1 y |
| DB connections | 28 open / 60 max (18 idle) |
| Realtime publication | 21 tables; 16 subscribed in code; 5 unsubscribed |

## Performance extremes

| Extreme | Finding |
|---|---|
| Most total DB time | Realtime `list_changes` WAL poll — 89,757 s cumulative, 18.6 M calls (DB-01) |
| Slowest app SQL (mean) | `project_nodes` reconciliation `(project_id,id) IN …` — 723 ms mean, 2.4 s max (DB-03) |
| Slowest SQL overall (mean) | PostgREST `pg_timezone_names` — 513 ms mean, 3.5 s max (DB-06) |
| Slowest single statement | Realtime WAL poll — 10.0 s max |
| Slowest endpoint measured | `/api/v1/health` — up to 2.1 s TTFB |
| Longest component | `ProjectSettingsTab.tsx` — 5,640 lines, one client component (FE-05) |
| Largest source file | `generated-client-catalog.ts` — 22,473 lines / 372 KB, reaches client (FE-03) |
| Heaviest route (client JS) | `/hub` — 1,675 KB raw across 44 chunks (manifest upper bound) |
| Largest table scan | `project_nodes` — 715 M rows read via 33,163 seq scans (DB-03) |

## Docs tab (v4) (8)

### DOC-08 · P1 · effort S — Docs tab does 3 queued server actions per open

- **Evidence:** list → read → previews; each calls `supabase.auth.getUser()` (network) and re-reads project + membership (3 sequential SQL). The page shell already loads the doc rows.
- **Fix:** Pass the doc list from the page shell; verify the JWT locally (`getViewerAuthContext`); one context query with a join.

### DOC-01 · P2 · effort S — Real-time co-editing leftovers

- **Evidence:** Token route `api/v1/projects/[id]/doc-collaboration-token`, `lib/realtime/doc-collaboration-token.ts`, `doc-collaboration-document.ts`; no client ever called the route.
- **Fix:** Removed on main (A).

### DOC-02 · P2 · effort S — Doc image uploads

- **Evidence:** Route `api/v1/projects/[id]/doc-assets/[assetId]`, asset cleanup in unlink, asset types/constants; `project_markdown_assets` holds 0 rows.
- **Fix:** Code removed on main (A); table drop pending.

### DOC-03 · P2 · effort S — Write-only drafts

- **Evidence:** `draft_content` always written as ""; only dead search code read it; `project_markdown_draft_contributors` never read.
- **Fix:** Writes and Drizzle columns removed on main (A); column/table drop pending.

### DOC-04 · P2 · effort S — Quick Console and doc helpers

- **Evidence:** `ProjectDocQuickConsole.tsx` (1,195 lines), `ProjectDocSwitcher.tsx`, `doc-style.ts`, `doc-settings.ts`, editor source-map builders.
- **Fix:** Removed on main (A).

### DOC-05 · P2 · effort S — “Notify on publish” toggle

- **Evidence:** Settings tab promised notifications on publish; nothing sends them. `mediaUploads` setting gated removed uploads.
- **Fix:** Toggle and both settings removed on main (A); DB default cleanup pending.

### DOC-06 · P2 · effort S — Dead doc-edit layout mode

- **Evidence:** `isDocEditing` state whose setter only ever set false; contained-workspace branches in ProjectLayout.
- **Fix:** Removed on main (A).

### DOC-07 · P2 · effort S — 4 unused doc server actions

- **Evidence:** `validateProjectDocAction`, `createProjectMarkdownAction`, `readProjectMarkdownSearchAction`, `readProjectDocReferenceOptionsAction` (+ its hook).
- **Fix:** Removed on main (A).


## Ponytail audit: what to cut (20)

### PT-03 · P1 · effort S — 4.1 MB SVG sprite next to 745 per-icon files (also FE-03)

- **Evidence:** `public/skill-sprites.svg` 4.1 MB; `public/skill-icons/v1/*.svg` (745 files) already exist and are cached immutable.
- **Fix:** `native:` Delete the sprite; `<img src=/skill-icons/v1/<key>.svg>`.

### PT-06 · P1 · effort S — ~53 feature flags nobody sets (also RSC-05)

- **Evidence:** `src/lib/features/{files,hardening,messages,security,guidance}.ts` (293 lines): 20 files-wave flags, 16 hardening flags + rollout %, 12 messages flags + rollout %. None set in Railway; all default on. Only 4 files flags and 3 messages flags are read.
- **Fix:** `yagni:` Delete the modules; inline `true`; delete the 18+ `false` branches.

### PT-01 · P2 · effort S — Vendored agent skills in the repo (also SK-01)

- **Evidence:** `.agents/` — 405 files, 134,012 lines by line count (v2 quoted 123,203 from `wc -l`, which skips final lines without a newline).
- **Fix:** `delete:` Delete. Installed plugins already provide them.

### PT-02 · P2 · effort M — Client skill catalog duplicates the `skills` table (also FE-03)

- **Evidence:** `src/lib/skills/generated-client-catalog.ts` 22,473 lines; DB `skills` holds the same 1,128 rows.
- **Fix:** `yagni:` Delete; serve names from the server (see FE-03).

### PT-04 · P2 · effort S — 53 unreachable source files (also DEAD-01)

- **Evidence:** Reachability scan (DEAD-01): 6,060 lines + 411 lines of tests.
- **Fix:** `delete:` Delete.

### PT-05 · P2 · effort M — Scale-readiness tooling for 16 users

- **Evidence:** `check-1m-readiness`, `check-capacity-audit`, `check-production-rollout-readiness`, `run-load-suite`, `run-stability-release-gate`, `check-stability-env`, `check-hardening-rollout` (1,058 lines) + `ops/stability/*.json`.
- **Fix:** `yagni:` Delete. Re-add a load test when real traffic appears. ponytail: ceiling = current traffic; upgrade = sustained >100 rps.

### PT-07 · P2 · effort S — No-op telemetry stack

- **Evidence:** `src/lib/telemetry/otlp.ts` (333) + `RoutePerformanceObserver.tsx` (82): no `OTEL_*` endpoint set; client `console.*` is stripped in production (`removeConsole`). Also `instrumentation.ts` imports uninstalled OTel packages.
- **Fix:** `delete:` Delete all three. Railway metrics + Supabase stats cover today's needs.

### PT-08 · P2 · effort S — Load shedding with a global Redis bucket (also INF-02)

- **Evidence:** `src/lib/routing/load-shedding.ts` 97 lines, called on each page request.
- **Fix:** `yagni:` Delete (INF-02).

### PT-10 · P2 · effort M — framer-motion for fades and one reorder list

- **Evidence:** 10 files: 18 `motion.div`, 13 `AnimatePresence`, 1 `Reorder` list (LifecycleEditor) while `@dnd-kit` is also installed; `MotionConfig` in the root provider.
- **Fix:** `native:` CSS transitions + `tw-animate-css` (already installed) for fades; move LifecycleEditor to `@dnd-kit/sortable`. −1 dep.

### PT-12 · P2 · effort M — 517-line wrapper around next-themes

- **Evidence:** `theme-provider.tsx` re-implements system/resolved theme on top of `next-themes`.
- **Fix:** `shrink:` Keep next-themes + the accent/reduced-motion bits (~120 lines).

### PT-13 · P2 · effort S — Unused packages (also DEAD-03, RSC-04)

- **Evidence:** `next-intl`, `ai`, `@ai-sdk/google`, `@vercel/analytics`, `radix-ui` meta (dup of `@radix-ui/*`), `cookie` (imported only for a type in `browser-cookie-store.ts`; use `@supabase/ssr` `CookieOptions`) + `@types/cookie`.
- **Fix:** `delete:` Remove. −7 deps.

### PT-14 · P2 · effort S — Read replica abstraction with no replica

- **Evidence:** `readDb` / `db` split in `lib/db/index.ts` + transient fallbacks (e.g. legal acceptance) while `READ_DATABASE_URL` is unset.
- **Fix:** `yagni:` One `db` export; delete fallback branches.

### PT-09 · P3 · effort S — Barrels that re-export one file

- **Evidence:** `actions/project/index.ts` (82 lines) says "re-exports from split modules" but everything lives in `_all.ts` (11,110 lines); same for `actions/messaging/index.ts` (62). Plus 14 pure re-export files (`discover/`, `network/`, `my-profile/` pages, `hub/`/`people/` loading, `api/completion`, `api/inngest`, `chat/index`, `dashboard/index`, `skills/index`, `services/index`, `files/index`, e2e `route-impl`).
- **Fix:** `yagni:` Rename `_all.ts` → `index.ts`, delete the barrels and re-export files (after RT-01/RT-02).

### PT-11 · P3 · effort M — date-fns for relative time

- **Evidence:** 23 files; 16 use only `formatDistanceToNow`. `lib/utils/date.ts` exists (13 lines).
- **Fix:** `native:` `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat` in `lib/utils/date.ts`. −1 dep.

### PT-15 · P3 · effort S — Process-global in-flight dedupe beside React `cache()`

- **Evidence:** `lib/utils/inflight-dedupe.ts` used at 46 call sites; React `cache()` already dedupes per request and React Query dedupes on the client.
- **Fix:** `yagni:` Delete where a `cache()` wrapper already exists; keep only for cross-request fan-in if measured.

### PT-16 · P3 · effort S — Dead env knobs and platform sniffing

- **Evidence:** 101 env names read in code but unset in production, incl. `NEXTAUTH_SECRET`/`AUTH_SECRET` fallback (NextAuth not used), `FLY_APP_NAME`/`RENDER`/`KUBERNETES_SERVICE_HOST`/`AWS_EXECUTION_ENV` sniffing in `actions/laptop-ides.ts`, `HUB_RANKING_WEIGHTS`, `DB_USE_SUPAVISOR_PORT`, `MOCK_USER_ID` auth bypass in `lib/supabase/server.ts` (security: route to /cso). `REDIS_URL` is set in Railway but never read.
- **Fix:** `delete:` Delete the knobs and branches; unset `REDIS_URL`.

### PT-17 · P3 · effort S — 22 unused app icon files

- **Evidence:** 22 of 29 `public/icon-*` files are referenced nowhere in `src/` or the manifest.
- **Fix:** `delete:` Delete.

### PT-18 · P3 · effort S — E2E auth route via bundler aliases

- **Evidence:** `next.config.ts` resolveAlias (webpack + turbopack) swaps `route.dev.ts`/`route.disabled.ts` behind `route-impl.ts`.
- **Fix:** `shrink:` One `route.ts` with `if (process.env.NODE_ENV === 'production') notFound()` like `onboarding-preview`.

### PT-19 · P3 · effort S — Duplicate folder conventions

- **Evidence:** `src/hooks` + `src/lib/hooks`, `src/stores` + `src/lib/stores`, `src/types` + `src/lib/types`, `lib/utils.ts` + `lib/utils/`, empty `services/presence/src`.
- **Fix:** `yagni:` Pick one of each; delete the empty `services/`.

### PT-20 · P3 · effort S — Three lockfiles (also DEAD-03)

- **Evidence:** `package-lock.json`, `pnpm-lock.yaml`, `bun.lock`; scripts use npm.
- **Fix:** `yagni:` Keep `package-lock.json`.


## Infrastructure and network (11)

### INF-01 · P0 · effort S — Web origin runs in Amsterdam; edge, DB and Auth are in Singapore

- **Evidence:** Railway `networkbase-web` multiRegionConfig = `ams` (1 replica). Responses carry `x-railway-edge: sin1`. Supabase project region `ap-southeast-1`. Each request crosses Singapore→Amsterdam, then every DB/Auth call crosses back (~160 ms RTT each). 7-day p90 reaches 2.04 s and p99 3.95 s; `/api/v1/live` (no DB) still has 620–740 ms TTFB.
- **Fix:** Move `networkbase-web` and `networkbase-worker` to Railway `asia-southeast1` (Singapore), same as Supabase. Keep 1 replica. Expected: −150 to −300 ms per request, and −160 ms for each sequential query in a waterfall.

### INF-02 · P1 · effort S — Redis (Upstash) region not co-located and hit on every document request

- **Evidence:** `consumeRouteClassLoadShedding` calls `consumeRateLimitPolicy` (Redis) for each non-RSC page request in production (`LOAD_SHEDDING_ENABLED` defaults on). Route rate limits (`enforceRouteLimit`) also use Redis on every API call.
- **Fix:** `yagni:` Delete `src/lib/routing/load-shedding.ts` (97 lines) and its proxy call. A global Redis token bucket guards nothing at 16 users; Railway restarts handle overload. Co-locate Upstash with the web service for the per-user limits that stay.
- *v1 fix (replaced by ponytail-review):* Put the Upstash database in the same region as the web service. Replace global load-shed token bucket with an in-process bucket (single replica), keep Redis only for per-user API limits.

### INF-11 · P1 · effort S — Liveness and readiness probes go through a Redis rate limit

- **Evidence:** `/api/v1/live` and `/api/v1/ready` call `enforceRouteLimit` (Upstash REST) on every probe. Railway probes `/api/v1/live`; measured TTFB 603–925 ms for a route that touches no data.
- **Fix:** `delete:` Delete the rate limit on `/live` and `/ready`. Probes are internal and cheap.

### INF-03 · P2 · effort S — `/` answers 307 → `/login` for anonymous visitors

- **Evidence:** `curl -I https://networkbase.in/` → `307 location: /login`, 620–840 ms before the real page even starts.
- **Fix:** Render the login (or landing) page at `/` directly, or use a rewrite instead of a redirect. Saves one full round trip on first visit.

### INF-04 · P2 · effort M — Static legal pages are sent `no-store` and rendered per request

- **Evidence:** `/terms` → `cache-control: private, no-cache, no-store`, server response 342 ms, 72 KB HTML + 43 KB inline RSC payload. Cause: root layout awaits `headers()` for a CSP nonce, which forces every route dynamic.
- **Fix:** Put legal/marketing pages in a route group with their own layout that does not read headers; mark them `force-static`. Cloudflare can then cache them at the edge.

### INF-05 · P2 · effort M — 41% of production requests end in 4xx

- **Evidence:** Railway 7-day totals: 2xx 1,920, 3xx 400, 4xx 1,594, 5xx 0 (3,914 total). `/discover` returns 404 for anonymous users in production.
- **Fix:** Break down 4xx by path in Railway logs. Likely sources: bots on unknown paths, 401s from API calls fired before auth, and the `/discover` 404. Fix callers that fire requests without a session.

### INF-06 · P2 · effort S — Production deploys a different branch than local `main`

- **Evidence:** Service source = `rama730/nb-s3.2` branch `codex/railway-production`. Production behaviour differs from main (CSP only on proxy-matched routes, `/discover` 404). Local `main` has 745 uncommitted modified files.
- **Fix:** Commit the working tree, then deploy from one branch (`main`) through one pipeline so audit findings map 1:1 to what runs.

### INF-07 · P3 · effort S — Health-check path mismatch and slow `/api/v1/health`

- **Evidence:** `railway.toml` says `/api/v1/health`; live service config uses `/api/v1/live`. `/api/v1/health` measured 0.89–2.11 s (touches DB cross-region).
- **Fix:** Use `/api/v1/live` everywhere for liveness; keep `/health` for manual readiness only. Update `railway.toml`.

### INF-08 · P3 · effort S — Node heap capped at 384 MB on a 1 GB container

- **Evidence:** `start`: `NODE_OPTIONS='--max-old-space-size=384'`. Memory 7-day: 252–299 MB, steady (no leak seen). CPU avg ≈ 0.01% of 2 vCPU.
- **Fix:** Raise cap to ~700 MB (headroom for image/tarball work) or remove the flag. No memory leak detected, so no leak work needed.

### INF-09 · P3 · effort S — OpenTelemetry imports packages that are not installed

- **Evidence:** `src/instrumentation.ts` dynamically imports `@opentelemetry/sdk-node`, `exporter-trace-otlp-grpc`, `resources`; none are in package.json. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` would crash startup.
- **Fix:** `delete:` Delete the OTel block and the 3 `serverExternalPackages` entries (PT-07).
- *v1 fix (replaced by ponytail-review):* Either add the deps or delete the block and the `serverExternalPackages` entries.

### INF-10 · P3 · effort S — Network basics pass

- **Evidence:** HTTP/2 via Cloudflare, Brotli on HTML/JS/CSS, `/_next/static` `immutable` 1-year cache, fonts woff2 (23 KB, 29 KB), images AVIF/WebP with 31-day TTL. No action beyond INF-01..04.
- **Fix:** Keep. Optional: enable HTTP/3 and Early Hints in Cloudflare.


## Middleware / proxy (8)

### MW-01 · P0 · effort M — Two middleware files; the one with CSP/CSRF never runs on `main`

- **Evidence:** Root `middleware.ts` (CSP nonce, CSRF cookie, `x-route-metric`, `x-networkbase-request-target`) and `src/proxy.ts` both exist. With `src/app`, Next 16 builds only `src/proxy.ts`: `.next/server/functions-config-manifest.json` shows the proxy matchers and `middleware.js` contains zero `Content-Security-Policy` strings. Effects: no CSP on most routes (prod `/terms` has none), `x-nonce` always empty, legal-accept redirect loses `next` target, route metrics header missing.
- **Fix:** Merge both into one `src/proxy.ts` (CSP + CSRF + auth + canonical redirects) with one matcher, delete root `middleware.ts`, add a build check that asserts CSP is present on `/terms`.

### MW-02 · P1 · effort S — Proxy matcher is stale

- **Evidence:** Matcher includes `/hub`, `/people`, `/profile` (already 308-redirected by next.config) and `/monitor` (no route). Misses `/projects/*`, `/admin/*`, `/authorize`, `/verify-email`, `/legal/*`.
- **Fix:** `shrink:` Use one catch-all matcher that excludes static files (as the root file already does) and branch on `route-class.ts` inside the proxy. No generated matcher.
- *v1 fix (replaced by ponytail-review):* Generate the matcher from `src/lib/routing/route-class.ts` so one table drives both.

### MW-03 · P1 · effort M — Proxy may query the DB for onboarding status on each page load

- **Evidence:** `resolveProfileOnboardingComplete` runs a PostgREST `profiles` select when claims lack onboarding state — a Singapore round trip inside middleware, before any rendering.
- **Fix:** `delete:` Stop checking onboarding in the proxy. `(main)/layout` already reads the viewer; redirect to `/onboarding` from there. No JWT hook, zero DB calls in the proxy.
- *v1 fix (replaced by ponytail-review):* Add `onboarding_status` (and legal-acceptance version) to the JWT via a Supabase custom access-token hook. The proxy then decides from claims only, with zero DB calls.

### MW-04 · P2 · effort M — Auth resolved 2–3 times per navigation

- **Evidence:** Proxy verifies the JWT → `(main)/layout` calls `getViewerAuthContext` (verifies again) → `hasCurrentLegalAcceptance` DB query → page calls identity/profile reads.
- **Fix:** `delete:` Keep one `cache()`d verify per request. The legal check keeps its existing 10-min in-process cache; delete the second verify in the proxy for app routes. No claims hook (MW-03 v2).
- *v1 fix (replaced by ponytail-review):* After MW-03, the layout trusts claims for legal/onboarding gating. Keep one `cache()`d verify per request; drop the legal DB read from the hot path (cache 10 min in-process already exists — move to claim).

### MW-05 · P2 · effort M — JWT verification can fall back to a network `auth.getUser()` call

- **Evidence:** `resolveAuthSnapshot` falls back to `supabase.auth.getUser()` (Auth server in Singapore) on any local verify error. `SUPABASE_JWT_SECRET` (legacy HS256) is set in Railway.
- **Fix:** Switch Supabase to asymmetric JWT signing keys; verify via cached JWKS only; log and reject instead of network fallback.

### MW-06 · P2 · effort S — Middleware bundle is 547 KB

- **Evidence:** `.next/server/middleware.js` = 547,557 bytes (node runtime). Pulls logger, route-class, rate-limit, snapshot, cookie options.
- **Fix:** `delete:` Proxy imports only what it runs (verify, cookies, redirect). Log errors only; delete per-request info logs. No sampling layer.
- *v1 fix (replaced by ponytail-review):* Keep proxy imports minimal (jose-style verify, cookie read, redirect). Move logging to sampled async.

### MW-07 · P2 · effort M — CSRF token needs an extra serial request

- **Evidence:** Client fetch patch calls `GET /api/v1/security/csrf` (Redis-rate-limited) before the first mutating fetch.
- **Fix:** `native:` Keep as is until MW-01 lands; then the proxy sets the cookie on first HTML response and the extra GET only happens once per 12 h. Do not add a meta-tag path. (Replacing CSRF with Origin + SameSite is a security decision; route to /cso.)
- *v1 fix (replaced by ponytail-review):* Once MW-01 issues the cookie, render the token into a nonce'd meta tag, or rely on Origin/SameSite checks for same-site JSON APIs (server actions already check Origin).

### MW-08 · P3 · effort S — Production CSP allows `ws://localhost:*` and Vercel analytics

- **Evidence:** Live CSP on `/`: `connect-src ... ws://localhost:* ws://127.0.0.1:* ws://0.0.0.0:*` and `script-src ... https://va.vercel-scripts.com`. `isLocalHostname(request.nextUrl.hostname)` sees the internal host behind Railway.
- **Fix:** Check `x-forwarded-host` instead of `nextUrl.hostname`; drop the Vercel host with DEAD-03.


## Database and SQL (25)

### DB-01 · P0 · effort M — Realtime `postgres_changes` WAL polling uses 89% of all DB time

- **Evidence:** `pg_stat_statements`: Realtime `list_changes` queries = 89,757 s + 40,836 s + 13,701 s (25.4 M calls, max 10 s). That is 144,318 s of 161,521 s total since the stats reset on 2026-01-16: **89%** (v1 said >95%; corrected). Publication `supabase_realtime` has 21 tables; 5 have no subscriber anywhere in code: `connections`, `task_comment_likes`, `message_read_receipts`, `message_delivery_receipts`, `file_versions` (receipts are the highest-write tables).
- **Fix:** `yagni:` Step 1 (today): `ALTER PUBLICATION supabase_realtime DROP TABLE connections, task_comment_likes, message_read_receipts, message_delivery_receipts, file_versions;` Step 2 only if Realtime is still >50% of DB time after Step 1 and INF-01: move per-user feeds to Broadcast. ponytail: ceiling = 16 published tables; upgrade = Realtime share stays >50%.
- *v1 fix (replaced by ponytail-review):* Step 1 (today): `ALTER PUBLICATION supabase_realtime DROP TABLE` those 5. Step 2: move per-user feeds (`user_notifications`, `conversation_participants`, `message_hidden_for_users`, `profiles`) to Realtime Broadcast from DB triggers (`realtime.broadcast_changes`) on private channels. Broadcast does not poll WAL.

### DB-02 · P0 · effort S — Connection churn: 117k type fetches, 500k pooler auths

- **Evidence:** `pg_type` typarray query 117,251 calls / 55.7 M rows (postgres.js `fetch_types` on each new connection); `pgbouncer.get_auth` 500,660 calls; `DISCARD ALL` 72,220. Pool config: `idle_timeout: 10s`, transaction pooler port 6543, max 20, on a long-running Railway server.
- **Fix:** In `src/lib/db/index.ts`: `idle_timeout: 300`, `max_lifetime: 60*30`, `fetch_types: false`, `max: 10`. On a long-lived server prefer the session pooler (5432) or direct connection, with `prepare: true`. Removes a TLS + auth handshake cross-region on most requests.

### DB-03 · P1 · effort S — `project_nodes` full scans: 715 M rows read

- **Evidence:** `pg_stat_user_tables`: 33,163 seq scans, 715,361,702 rows read (30,557 live). Slowest app SQL: reconciliation `(project_id,id) IN ...` 723 ms mean × 2,187 (max 2.4 s); storage.objects ⟕ project_nodes 503 ms × 2,304; `s3_key LIKE` 502 ms × 547; tombstone scan `deleted_at IS NOT NULL AND metadata->>'permanentDeleteRoot' = id::text` 141 ms × 6,560 with 0 rows.
- **Fix:** `shrink:` Three partial indexes only: `(project_id, id) WHERE type='file' AND deleted_at IS NULL`; `(s3_key text_pattern_ops) WHERE type='file' AND deleted_at IS NULL`; `(updated_at) WHERE deleted_at IS NOT NULL AND (metadata->>'permanentDeleteRoot') = id::text`. No new column.
- *v1 fix (replaced by ponytail-review):* Add partial indexes: `(project_id, id) WHERE type='file' AND deleted_at IS NULL`; `(s3_key text_pattern_ops) WHERE type='file' AND deleted_at IS NULL`; `(updated_at) WHERE deleted_at IS NOT NULL AND (metadata->>'permanentDeleteRoot') = id::text`. Better: promote `permanentDeleteRoot` to a boolean column.

### DB-04 · P1 · effort S — `git-sync-recovery` rewrites the same rows every 15 min

- **Evidence:** `update github_sync_runs set credential = $1 where status in (...) and created_at < $7` — 16,405 runs, 65,620 row writes, all already NULL. Plus 4 more statements per run even when idle.
- **Fix:** Add `isNotNull(githubSyncRuns.credential)` to the WHERE; fold the three UPDATEs into one CTE; exit early when no `review/running/queued` rows exist (cheap indexed EXISTS).

### DB-05 · P1 · effort S — `project_node_events` JSON lookup with 200 bind params

- **Evidence:** `SELECT metadata->>'key' FROM project_node_events WHERE project_id=$1 AND metadata->>'key' IN ($2..$201)` — 186 ms × 935 and 181 ms × 544.
- **Fix:** `shrink:` Expression index `(project_id, (metadata->>'key'))` + `= ANY($2::text[])`. No schema change.
- *v1 fix (replaced by ponytail-review):* Expression index `(project_id, (metadata->>'key'))` on the partitioned table (or promote `key` to a column). Pass one array: `= ANY($2::text[])` so the plan is reusable.

### DB-06 · P2 · effort M — PostgREST schema cache reloads cost ~0.8 s DB each

- **Evidence:** `SELECT name FROM pg_timezone_names` 3,870 × 513 ms (max 3.5 s) + type/relationship introspection 3,870 × 134 ms and × 57 ms. Triggered by DDL (partition maintenance, migrations) and 1,996 replication-slot checks.
- **Fix:** Avoid DDL at runtime (create a year of partitions ahead in one migration). Limit `db_schemas` in Supabase API settings to `public`. The app reads mostly via Drizzle, so PostgREST use is small.

### DB-07 · P2 · effort M — Presence writes a hot row that is published to Realtime

- **Evidence:** `update profiles set last_active_at` 9,861 × 24 ms + 3,113 × 41 ms (max 1.4 s). `profiles` is in the Realtime publication, so each write is decoded for every subscriber.
- **Fix:** `delete:` Delete the unconditional `update profiles set last_active_at` path (9,861 calls); keep only the throttled `... AND last_active_at < $3` variant with a 5-min window. No new table.
- *v1 fix (replaced by ponytail-review):* Move `last_active_at` to a small `profile_presence` table not in the publication, or use Realtime Presence only. Throttle to one write per 5 min.

### DB-08 · P2 · effort S — Project view counter writes through on every view

- **Evidence:** `update projects set view_count = view_count + $2` 1,833 × 30 ms (max 1.2 s). Railway sets `PROJECT_VIEWS_WRITE_THROUGH`, while `flush-views` already batches every 15 min.
- **Fix:** Unset `PROJECT_VIEWS_WRITE_THROUGH`; rely on Redis increments + the flush cron.

### DB-09 · P2 · effort M — Cron jobs poll even when there is no work

- **Evidence:** `job_heartbeats` upsert 32,851; active-sprint scan 32,807 (0 rows); notification push scan 32,805 (4.2 ms, 16 rows total); 22 cron functions total, 8 run every 15 min or faster.
- **Fix:** `delete:` Delete `job_heartbeats` writes on no-op runs; move idle 15-min crons to hourly. No event wiring.
- *v1 fix (replaced by ponytail-review):* Trigger from events (Inngest `step.sendEvent` on insert) instead of scanning; write heartbeat only on change; lengthen idle crons to hourly.

### DB-10 · P2 · effort S — Skill catalog re-upserted at runtime

- **Evidence:** `UPDATE skills ...` 13,578 calls, `INSERT INTO skills ...` 13,578, `INSERT INTO skill_aliases ...` 14,871 — for a 1,128-row catalog.
- **Fix:** `delete:` The upserts come from the manual `skills:backfill` script. Run it only when `skills-catalog` changes; add nothing.
- *v1 fix (replaced by ponytail-review):* Seed the catalog once per catalog hash (store hash in a meta row; skip when unchanged). Run only from the migration/script, never from request paths.

### DB-11 · P2 · effort S — Duplicate index on `dm_pairs`

- **Evidence:** Advisor: `dm_pairs_user_low_high_unique` and `dm_pairs_user_low_user_high_key` are identical.
- **Fix:** `DROP INDEX dm_pairs_user_low_high_unique;` (keep the constraint-backed one).

### DB-12 · P2 · effort S — Four unindexed foreign keys

- **Evidence:** `github_sync_runs.actor_id`, `sprint_task_memberships.added_by`, `.project_id`, `.removed_by`.
- **Fix:** Add btree indexes (or composite ones that lead with these columns).

### DB-14 · P2 · effort M — Workspace counters stored twice

- **Evidence:** `profiles` and `profile_counters` both carry `workspace_inbox_count`, `due_today_count`, `overdue_count` with indexes on both (none used).
- **Fix:** Keep counters only in `profile_counters`; drop the `profiles` columns and indexes.

### DB-15 · P2 · effort S — RLS policies re-evaluate `auth.uid()` per row

- **Evidence:** Advisor `auth_rls_initplan`: `project_invitations_read_authorized`, `project_guidance_appointments_read_authorized`.
- **Fix:** Wrap as `(select auth.uid())` in both policies.

### DB-17 · P2 · effort S — Security advisor warnings

- **Evidence:** `sync_profile_to_auth_user_metadata()` is SECURITY DEFINER and executable by `anon` and `authenticated` via `/rest/v1/rpc`. Mutable `search_path` on it and `seed_project_workflow_columns`. Leaked-password protection is off. 33 tables have RLS with no policies (server-only; acceptable, document it).
- **Fix:** `REVOKE EXECUTE ... FROM anon, authenticated`; `SET search_path = ''` on both functions; enable HaveIBeenPwned check in Auth settings.

### DB-18 · P2 · effort S — Two COUNT queries for one badge

- **Evidence:** Unread (`read_at IS NULL`) 56,819 calls and unseen (`seen_at IS NULL`) 48,178 calls on `user_notifications`, plus `SUM(unread_count)` on `conversation_participants` 16,009.
- **Fix:** `shrink:` One `SELECT count(*) FILTER (WHERE read_at IS NULL), count(*) FILTER (WHERE seen_at IS NULL) ...`. No counter table, no Broadcast.
- *v1 fix (replaced by ponytail-review):* One query returning both counts with `FILTER`; better, maintain counts in `profile_counters` and push via Broadcast.

### DB-19 · P2 · effort S — Read-replica fallback repeats the same SQL on the same pool

- **Evidence:** `hasCurrentLegalAcceptance` retries on `db` after a `readDb` error. No `READ_DATABASE_URL` is set, so `readDb === db` and the fallback re-runs the identical query.
- **Fix:** Remove the `readDb`/`db` split until a replica exists; keep `withDbRetry` only.

### DB-20 · P2 · effort M — N+1 loops (query per item)

- **Evidence:** `project/workflow.ts:104-107` (2 updates per column), `api/v1/extension/bulk-finalize/route.ts:86` (findFirst per intent), `lib/github/sync-runner.ts:60-72` (findFirst + insert per path; 11,892 `parent_id+name` lookups), `inngest/functions/flush-views.ts:92`, `flush-likes.ts:82-86`, `account-cleanup.ts:93,144`, `actions/task.ts:1047`, `actions/upload-import.ts:710`, `actions/project/_all.ts:10088`, `actions/files/mutations.ts:820`, `lib/github/sync-service.ts:806-825`, `lib/extension/recovery-sessions.ts:10-19`.
- **Fix:** Batch: `UPDATE t SET ... FROM (VALUES ...) v WHERE t.id = v.id`, `INSERT ... ON CONFLICT` with arrays, `WHERE id = ANY($1)`.

### DB-23 · P2 · effort S — Unused SQL objects

- **Evidence:** Tables with no app reference: `collection_projects` (0 rows), `saved_projects` (0), `skill_popularity_snapshots` (0), `profile_interests` (script-only), `skill_icon_assets` (745 rows, written by scripts, never read by the app). View `onboarding_funnel_dimensions_daily` (no reference). Function `app_private.nb_validate_dm_conversation` (not used by any trigger, policy, function or code). 197 never-scanned non-unique indexes (9.5 MB).
- **Fix:** `delete:` Drop the 4 empty/unused tables with their policies and indexes; keep `skill_icon_assets` only if the catalog script is the source of truth (else drop and read `/skill-icons/v1`). Drop the view and function. Re-check indexes after 30 days of traffic.

### DB-24 · P2 · effort M — SQL naming is inconsistent

- **Evidence:** Indexes: 350 `*_idx` vs 42 `idx_*`; unique: 51 `*_unique` vs 7 `*_uidx` vs 3 `*_key`; 3 composite PKs named `*_pk`; 2 odd names. Policies: 114 sentence-style vs 50 snake_case. Triggers: `trg_`, `tr_`, `trigger_` prefixes vs none. Docs feature named `project_markdowns*` + `readme` (4 tables, enum `status_readme_asset`, 4 functions, 12 policies) while the UI says Docs. Enum `status_role_app` abbreviates.
- **Fix:** `shrink:` One migration of renames only (instant, no data moves); see the SQL plan. Update `src/lib/db/schema/index.ts` names to match.

### DB-25 · P2 · effort M — Monthly partitioning for 9.7k rows

- **Evidence:** `project_node_events` has 13 partitions (7 hold 0 rows; total ≈9,700), a trigger per partition, `create_future_partitions()`, and a monthly `database-partition-maintenance` cron.
- **Fix:** `yagni:` Collapse into one plain table; drop the per-partition triggers, `create_future_partitions()` and the cron. ponytail: ceiling = ~10 M rows; upgrade = retention deletes or scans get slow.

### DB-13 · P3 · effort M — 208 indexes never used

- **Evidence:** Advisor `unused_index` count 208 (e.g. 3 message search indexes: `messages_content_trgm_idx`, `messages_content_search_idx`, `messages_structured_*_trgm_idx`; per-partition `actor_id`/`project_id` indexes on `project_node_events_*`). Each index slows writes and WAL.
- **Fix:** Traffic is small (16 users), so stats are thin. Re-check after 30 days of real use, then drop in batches. Drop obvious duplicates now (see DB-14).

### DB-16 · P3 · effort S — Multiple permissive SELECT policies

- **Evidence:** `profile_project_contributions` and `profile_project_contribution_stages` have 2 permissive SELECT policies each for anon and authenticated.
- **Fix:** Merge into one policy per role with `OR`.

### DB-21 · P3 · effort S — E2E cleanup SQL runs against the production database

- **Evidence:** `delete from project_nodes where name ilike $1 or metadata->>... ilike $2` 261 × 271 ms (full scan).
- **Fix:** Point E2E at a Supabase branch or separate project.

### DB-22 · P3 · effort S — Pool and timeouts

- **Evidence:** `max_connections` 60, 28 open (18 idle). Statement timeout 8 s, idle-in-tx 5 s — sensible.
- **Fix:** Keep timeouts. Lower pool max to 10 after DB-02.


## Server rendering and data flow (10)

### RSC-01 · P1 · effort M — Root layout forces every route dynamic

- **Evidence:** `src/app/layout.tsx` awaits `headers()` to read `x-nonce` (which is never set on main, see MW-01). All 30+ pages render per request, including `/terms`, `/privacy` and 10 other legal pages.
- **Fix:** Read the nonce only in layouts that need inline scripts; give legal pages a static route group (INF-04).

### RSC-02 · P1 · effort M — Sequential server waterfall on every app page

- **Evidence:** `(main)/layout`: verify auth → `hasCurrentLegalAcceptance` (DB) → render. `projects/[slug]/page`: auth (cached) → `getViewerIdentityContext` (DB) → `readProjectDetailShell` (DB, several reads) → `readProjectSprintDetail` (DB) when on Sprints. ≥4 sequential trips × ~160 ms cross-region.
- **Fix:** `shrink:` INF-01 first. Then start identity + shell reads together (`Promise.all`) and stream sprint detail in its own Suspense boundary. Legal check stays cached in-process (MW-04).
- *v1 fix (replaced by ponytail-review):* INF-01 first. Then start identity + shell reads together (`Promise.all`), move legal check to claims (MW-03), and stream sprint detail in its own Suspense boundary.

### RSC-07 · P1 · effort L — Server actions used as GET data loaders in 51 client files

- **Evidence:** `useQuery`/`useInfiniteQuery` `queryFn`s call `@/app/actions/*` in 51 files (TopNav, WorkspaceIndicator, MessageAttentionProvider, PeopleNotificationsProvider, files tab, tasks, messages…). Next runs server actions one at a time per client, as uncacheable POSTs, each re-verifying auth. Confirmed: `ProjectSettingsTab.tsx:1219` fires 6 server actions on mount under a `ponytail:` comment that says "parallel"; Next queues them, so they run one after another (≥6 × cross-region RTT).
- **Fix:** `shrink:` Per screen, merge the mount-time actions into one action that returns everything (e.g. ProjectSettingsTab's 6 loaders → 1). One queued POST instead of six. Only move a read to a GET route when it must be cached or shared.
- *v1 fix (replaced by ponytail-review):* Move reads to GET route handlers under `/api/v1` (cacheable, parallel) or pass initial data from RSC and hydrate React Query. Keep server actions for mutations only.

### RSC-03 · P2 · effort S — App shell waits for auth before painting

- **Evidence:** `(main)/layout` wraps `AuthRouteProviders + MainLayout` in one Suspense with a blank `div` fallback, so the sidebar/top nav cannot stream before auth resolves.
- **Fix:** Render `MainLayout` chrome outside the suspended part; suspend only the content slot.

### RSC-04 · P2 · effort S — `next-intl` loads messages for zero consumers

- **Evidence:** Root layout wraps the app in `NextIntlClientProvider` with `getMessages()`. No `useTranslations`/`getTranslations` anywhere. `src/messages/en.json` is 1.8 KB, one locale.
- **Fix:** Remove `next-intl`, the plugin in `next.config.ts`, `src/i18n/`, `src/messages/`.

### RSC-05 · P2 · effort M — Eight hardening feature flags are always on

- **Evidence:** `src/lib/features/hardening.ts`: 8 flags default `true` + 100% rollout; none set in Railway variables. 18 call sites keep dead `false` branches (e.g. hub page size 18 vs 24, theme provider branch).
- **Fix:** Delete the flag module and the unused branches.

### RSC-06 · P2 · effort M — `revalidatePath` targets wrong or redirected paths

- **Evidence:** 86 calls. 10 target `/hub`, `/people`, `/profile` (308-redirected). ≥16 target `/projects/${projectId}` while the route key is the slug. Some target `/projects/<slug>/readme` and `/files`, which are not routes. Since pages are dynamic, these only clear the router cache.
- **Fix:** `delete:` Delete the ~30 `revalidatePath` calls whose target is a redirect or a non-route. Add no cache layer until a page is measured slow for a cacheable read.
- *v1 fix (replaced by ponytail-review):* Tag cached reads (`'use cache'` + `cacheTag('project:'+id)`) and call `updateTag`/`revalidateTag`; delete path calls for non-routes.

### RSC-10 · P2 · effort S — 11 notification emitters are defined but never called

- **Evidence:** `emitTaskAssignedNotification`, `emitTaskStatusAttentionNotification`, `emitTaskCommentMentionNotification`, `emitTaskCommentReplyNotification`, `emitFileVersionAddedNotification`, `emitProjectRoleChangedNotification`, `emitProjectMemberRemovedNotification`, `emitProjectOwnershipTransferredNotification`, `emitApplicationReceivedNotification`, `emitApplicationDecisionNotification`, `emitTaskFileNotification` have zero call sites.
- **Fix:** Decide per event: wire the call where users expect the notification, delete the rest. Correctness question, route to /review.

### RSC-08 · P3 · effort S — `force-dynamic` in 32 files

- **Evidence:** Many are API routes that are dynamic anyway; some pages would be static after RSC-01.
- **Fix:** Remove from pages after RSC-01; keep on API routes. Keep the allowlist script.

### RSC-09 · P3 · effort S — `generateMetadata` adds DB reads on files/tasks tabs

- **Evidence:** `readProjectFileMetadataTitle` / `readProjectTaskMetadataTitle` run before streaming when `?fileId` / `?drawerId` present.
- **Fix:** Fold into the shell read, or use a generic title and set the precise one client-side.


## Client, React and bundle (18)

### FE-01 · P1 · effort M — ~1 MB client JS baseline on every page, including static ones

- **Evidence:** Per-route client reference manifests: minimum 1,056 KB raw for `/terms`, `/privacy`, `/workspace`. Measured `/terms`: 15 scripts, 735 KB decoded. Root layout ships QueryProvider, ThemeProvider with framer-motion `MotionConfig`, NextIntl, Tooltip, Sonner, CookieConsent (imports `@vercel/analytics`), RoutePerformanceObserver, SecurityRuntimeProvider.
- **Fix:** `native:` Root layout: fonts + theme pre-hydrate script + children. Move Query/Tooltip/Toaster into `(main)`/`(auth)` layouts. Delete `MotionConfig`; CSS `@media (prefers-reduced-motion)` already covers it. Delete Analytics.
- *v1 fix (replaced by ponytail-review):* Root layout: fonts + theme pre-hydrate script + children. Move Query/Tooltip/Toaster into `(main)`/`(auth)` layouts. Replace `MotionConfig` with CSS `prefers-reduced-motion` (or `LazyMotion` inside animated routes only). Drop Analytics (DEAD-03).

### FE-02 · P1 · effort L — Auth and onboarding pages are 1,000+ line client components

- **Evidence:** `/login` measured: 18 scripts, 295 KB br / 1,000 KB decoded, TTFB 777 ms, DCL 1.30 s, load 2.38 s. `login/page.tsx` 1,006 lines, `signup/page.tsx` 1,048, `onboarding/page.tsx` 1,139 — all `'use client'` pages.
- **Fix:** Server page shell + small client form islands; load Turnstile and Google Identity on interaction.

### FE-03 · P1 · effort M — Skill catalog and icon set shipped to the browser

- **Evidence:** `generated-client-catalog.ts` (22,473 lines, 372 KB) and `generated-icon-manifest.ts` (404 KB) are imported by 16 client components (ProjectCard, SkillChip, PersonCard, CommandPalette…). Chunk `1512` (281 KB: simple-icons + lucide) loads on `/hub`, `/projects/[slug]`. v2: `SkillIcon.tsx` renders `<use href="/skill-sprites.svg#…">`; the sprite is 4.1 MB (818 KB br in production). v1's fix ("use the sprite") would have made this worse.
- **Fix:** `native:` Delete `public/skill-sprites.svg` (4.1 MB raw, 818 KB brotli, downloaded whole on the first skill chip) and `generated-client-catalog.ts`. `SkillIcon` already has a path for the 745 per-icon files in `/skill-icons/v1/` (immutable cache): use `<img src>` so a page fetches only the icons it shows. Labels come from the server.
- *v1 fix (replaced by ponytail-review):* Use the existing `skill-sprites.svg` (immutable cache) via `<use href>`; send only the skill ids/labels a page needs from the server; search the catalog server-side.

### FE-04 · P1 · effort S — Tailwind scans the whole repo → 431 KB render-blocking CSS

- **Evidence:** One global CSS file: 431 KB raw / 53 KB br (371 KB decoded on `/login`). Tailwind v4 auto-detects sources from the project root: `docs/` (2.2 MB), `scratch/`, `artifacts/`, 154 root scratch files, `tests/`. `dark:` variants alone ≈ 78 KB.
- **Fix:** In `src/app/globals.css`: `@import "tailwindcss" source("../");` so only `src/` is scanned. Re-measure; expect a large cut.

### FE-05 · P1 · effort L — Very large client components

- **Evidence:** `ProjectSettingsTab.tsx` 5,640 lines (longest component), `GitHubSyncWorkspace.tsx` 2,646, `UpdatesTab.tsx` 2,600, `MessagesWorkspaceV2.tsx` 1,620, `Phase1SourceSelection.tsx` 1,560, `FolderListView.tsx` 1,371. One state change re-renders the whole tree; large parse/compile cost.
- **Fix:** Split per section, `dynamic()` import each settings section, colocate state in leaves.

### FE-06 · P2 · effort S — Unused state subscription re-renders the runtime provider tree

- **Evidence:** `MainRuntimeProviders` reads `isMessagesRoute` and `popupOpen` (zustand) but never uses them; `ChatPopupV2` is imported statically on every app page.
- **Fix:** Delete the two unused values; `dynamic(() => import(...ChatPopupV2), { ssr:false })` when the popup opens.

### FE-07 · P2 · effort M — Manual memoization everywhere

- **Evidence:** 471 `useEffect`, 564 `useCallback`, 346 `useMemo`, 34 `memo()` across `src/`.
- **Fix:** `delete:` Delete `useCallback`/`useMemo` around cheap values in files you touch. React Compiler is optional later (adds a Babel pass to builds); measure first.
- *v1 fix (replaced by ponytail-review):* Enable the React Compiler (`reactCompiler: true`, Next 16) and remove manual memo in touched files. Sweep effects that only derive state from props.

### FE-08 · P2 · effort S — Timers and listeners not centralized

- **Evidence:** 8 `setInterval` (FilesTabRoot ×2, useFileLease, GitHubSyncWorkspace heartbeat, IntegrationsSettings poll, ChatProvider 10-min heartbeat, signup countdown, visibility util). 57 `window.addEventListener` sites.
- **Fix:** `shrink:` Route all 8 intervals through the existing `lib/utils/visibility.ts`. No new store.
- *v1 fix (replaced by ponytail-review):* Use `src/lib/utils/visibility.ts` (already pauses on hidden tabs) for all intervals; share one `visibilitychange`/`online` listener via a small store.

### FE-09 · P2 · effort S — Polling and realtime both refresh the same data

- **Evidence:** 5 views poll every 300 s (`SavedFilesCollection`, `TaskFilesCollection`, `TrashFilesCollection`, `FolderListView`, `useTaskLinks`) while project-files/task realtime channels also invalidate them.
- **Fix:** `delete:` Delete the 5 `refetchInterval: 300_000` polls; realtime invalidation + React Query's refetch-on-focus/reconnect already keep them fresh.
- *v1 fix (replaced by ponytail-review):* Keep realtime invalidation; poll only when the channel status is not `SUBSCRIBED`.

### FE-10 · P2 · effort M — Broad cache invalidation

- **Evidence:** 144 `invalidateQueries` calls; many invalidate whole prefixes after a single-row mutation.
- **Fix:** `shrink:` Invalidate exact keys from the existing query-key factory instead of prefixes. No per-mutation cache writes.
- *v1 fix (replaced by ponytail-review):* Write mutation results into the cache with `setQueryData`; invalidate exact keys from the existing query-key factory.

### FE-11 · P2 · effort S — Hover prefetch fires server actions

- **Evidence:** `TaskFilesCollection.tsx:776` `onMouseEnter={() => handlePrefetchTask(group.id)}` calls a server action; actions are queued, so a sweep of the mouse blocks real mutations.
- **Fix:** `delete:` Delete the hover prefetch. The first click loads the group anyway.
- *v1 fix (replaced by ponytail-review):* Debounce 150 ms and fetch via GET (RSC-07).

### FE-12 · P2 · effort S — Login page fetches appearance settings for anonymous users

- **Evidence:** `/login` requests `/api/v1/appearance` (430 ms) with no session.
- **Fix:** Skip when signed out; read the theme from the existing pre-hydrate cookie/localStorage.

### FE-13 · P2 · effort S — Legal pages hydrate client JS they do not need

- **Evidence:** `/terms`: 72 KB HTML + 43 KB inline RSC payload + 735 KB JS for static text.
- **Fix:** After FE-01 and INF-04, legal pages ship near-zero client JS.

### FE-14 · P3 · effort S — Prefetch strategy inconsistent

- **Evidence:** 22 `prefetch={false}` Links plus manual `warmPrefetchRoute` on hover/focus in some places, `router.prefetch` on hover in others.
- **Fix:** `native:` Delete the 22 `prefetch={false}` and the manual `warmPrefetchRoute`; Next's default viewport prefetch for `<Link>` does the job. No wrapper component.
- *v1 fix (replaced by ponytail-review):* One `AppLink` wrapper: viewport prefetch for primary nav, hover prefetch elsewhere.

### FE-15 · P3 · effort S — Fonts

- **Evidence:** 3 local faces: Instrument Sans (variable), Instrument Serif, JetBrains Mono 100–800 variable. All preloaded globally; mono is used only in code/file views.
- **Fix:** `delete:` `preload: false` on JetBrains Mono and Instrument Serif. No subsetting step.
- *v1 fix (replaced by ponytail-review):* `preload: false` for mono and serif; subset JetBrains Mono to 400/600.

### FE-16 · P3 · effort S — Lists and tables

- **Evidence:** `react-virtuoso` used in 11 list views (messages, files, people) — good. Kanban (dnd-kit) not virtualized; fine at current sizes.
- **Fix:** Keep. Virtualize Kanban columns only if a column exceeds ~200 cards.

### FE-17 · P3 · effort S — `canvas-confetti` types in runtime deps

- **Evidence:** `@types/canvas-confetti` listed under `dependencies`.
- **Fix:** Move to `devDependencies`; confirm confetti is `import()`ed on use.

### FE-18 · P3 · effort S — Hydration warnings suppressed only where expected

- **Evidence:** 2 `suppressHydrationWarning` (html root, theme script). No hydration errors observed on public pages.
- **Fix:** Keep. Authenticated pages not measured (see gaps).


## Routes, duplicate names, hidden pages, API (8)

### RT-01 · P1 · effort M — Three pages have two names each

- **Evidence:** `/hub` ≡ `/discover`, `/people` ≡ `/network`, `/profile` ≡ `/my-profile`. The canonical dirs are 2-line re-exports of the legacy dirs; next.config 308-redirects the legacy URLs; code and tests reference legacy paths 108 times in 43 files (v3 count incl. tests; v1 counted ~50 in 26 prod files) (`actions/project/_all.ts`, `auth/callback`, `route-class.ts`, `page-contract.ts`, …). `ROUTES` has alias pairs `HUB/DISCOVER`, `PEOPLE/NETWORK`, `PROFILE/MY_PROFILE`.
- **Fix:** Move implementations into `discover/`, `network/`, `my-profile/`; delete `hub/`, `people/`, `profile/` (page + loading); replace all legacy strings; drop alias keys; keep the 308 redirects for old links.

### RT-03 · P1 · effort S — AI completion endpoint has no caller

- **Evidence:** `/api/v1/completion` (uses `ai` + `@ai-sdk/google`) — no fetch or `useCompletion` anywhere in `src/`.
- **Fix:** Delete the route and both packages, unless it is planned work.

### RT-02 · P2 · effort S — Duplicate API aliases

- **Evidence:** `/api/completion` re-exports `/api/v1/completion`; `/api/inngest` re-exports `/api/v1/inngest`.
- **Fix:** Delete the non-v1 files (point the Inngest app URL at `/api/v1/inngest` first).

### RT-04 · P2 · effort S — Hidden pages

- **Evidence:** `/onboarding-preview` (returns 404 in production but still built, 1.5 MB client manifest), `/admin/notifications` (admin-only, force-dynamic raw SQL), `/api/e2e/auth` (dev-only via alias).
- **Fix:** Delete `onboarding-preview` (move harness to tests). Keep admin page only if used; otherwise delete. Keep the e2e alias but exclude from prod build output.

### RT-05 · P3 · effort S — 23 empty route directories

- **Evidence:** e.g. `api/v1/upload-intent`, `api/v1/finalize-upload`, `api/test-view/[id]`, `api/realtime/presence-token`, `api/jobs/connection-bulk`, `api/v1/settings/bootstrap`, `(main)/notifications`, `(main)/settings/{account,security,privacy,appearance,languages,integrations,notifications}`, `projects/[slug]/sprints/[sprintId]`.
- **Fix:** `find src/app -type d -empty -delete`.

### RT-06 · P3 · effort M — Many tiny API routes

- **Evidence:** 90+ route handlers; `privacy/*` has 6 endpoints, `sessions/*` 4. Each runs CSRF + Redis rate limit + auth.
- **Fix:** Merge privacy settings into one PATCH endpoint and sessions into one resource with methods.

### RT-07 · P3 · effort S — Realtime binding on an unpublished table

- **Evidence:** `project-files-channel.ts` subscribes to `github_sync_runs`, which is not in the `supabase_realtime` publication — the handler never fires.
- **Fix:** Remove the binding (the sync UI already polls) or broadcast sync status explicitly.

### RT-08 · P3 · effort S — `hooks/hub/` holds project hooks

- **Evidence:** `useProjectDocData`, `useProjectMembers`, `useProjectTasksData`, `useUserInteractions` live in `src/hooks/hub/` but serve project pages.
- **Fix:** Move them to `src/hooks/projects/` during the Discover rename.


## Dead code, dependencies, repo (8)

### DEAD-01 · P2 · effort S — 53 unreachable source files (6,060 lines) + 7 tests that only cover them (411)

- **Evidence:** v3 reachability scan from every route, layout, proxy, worker, Inngest registry and kept script (v1/v2 used a direct-import scan: 36 files). Full list in the Removal ledger.
- **Fix:** Delete after one `tsc --noEmit` + build. Add `knip` to CI to stop regrowth.

### DEAD-03 · P2 · effort S — Unused or duplicate dependencies

- **Evidence:** `next-intl` (RSC-04); `ai` + `@ai-sdk/google` (RT-03); `@vercel/analytics` (host is Railway, render gated on `VERCEL` env which is unset); `radix-ui` meta package (3 files) alongside 10 `@radix-ui/*` packages; three lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `bun.lock`).
- **Fix:** Remove the four packages; switch the 3 `radix-ui` imports to `@radix-ui/*` and drop the meta package; keep one lockfile (npm, per scripts).

### DEAD-07 · P2 · effort M — 159 unused exported functions/constants + 37 unused types in live files

- **Evidence:** Token scan across src + tests + scripts: exported names with no other reference. ≈3,217 body lines + 188 type lines in 94 files; 55 of them are exercised only by tests. Largest: `SprintEditorModal` (405), `uploadRepoFiles` (200), `getTaskWorkingFilesCollection` (140), `uploadToStorageAndDB` (135), 11 notification emitters in `lib/notifications/emitters.ts` (446). Full list in the Removal ledger.
- **Fix:** `delete:` Delete, with the tests that only exercise them. Check the emitters first (see RSC-10).

### DEAD-02 · P3 · effort S — 11 modules used only by tests

- **Evidence:** `lib/files/save-logic.ts`, `lib/messages/v2-render-state.ts`, `lib/projects/doc-style.ts`, `lib/projects/task-file-note-sync.ts`, `lib/projects/task-file-presentation.ts`, `lib/security/json-ld.ts`, `lib/security/profile-visibility.ts`, `lib/skills/icon-sources.ts`, `lib/standards/impact-review.ts`, `lib/standards/sql-governance.ts`, `lib/validations/files.ts`.
- **Fix:** Delete with their tests unless a script depends on them (`lib/standards/*` feeds check scripts — keep those two).

### DEAD-04 · P3 · effort S — 53 scratch files in the repo root, 101 more in `scratch/`

- **Evidence:** 53 root-level non-config files (v1 said 154; that count included `scratch/`): PNG crops, `scratch_*.py`, `scratch_*.html`, `fix.py`, `fix-imports.js`, `refactor_runner.ts`, `test_out.log`, `tests-output.txt`, extra build dirs `.next-codex-audit`, `.next-verify`. They also feed Tailwind scanning (FE-04).
- **Fix:** Move to `scratch/` (gitignored) or delete.

### DEAD-05 · P3 · effort M — Release gate runs ~45 checks one after another

- **Evidence:** `test:release-gate` chains ~45 npm scripts with `&&`; 76 scripts, ~50 `check:*` contracts. Some guard features this audit removes (hub canonical, hardening rollout).
- **Fix:** `delete:` Delete contracts that guard removed features (hub-canonical, hardening-rollout, 1m-readiness, capacity-audit, production-rollout, load-suite, stability gate). Keep the rest serial; no runner dependency.
- *v1 fix (replaced by ponytail-review):* Run independent checks in parallel groups; delete contracts for removed features; keep one `check:all` entry.

### DEAD-06 · P3 · effort S — Build config leftovers

- **Evidence:** `build` uses `--webpack` (Turbopack is the Next 16 default and faster); `turbopackFileSystemCacheForDev: false`; `optimizePackageImports` lists 9 codemirror packages that are already lazy.
- **Fix:** Try `next build` with Turbopack and compare output; trim the list.

### DEAD-08 · P3 · effort M — Migration history hygiene

- **Evidence:** 167 SQL files / 57,608 lines. `0152_message_preview_backfill.sql` is not in `_journal.json` (never applied by the runner). 11 migration numbers are used twice (0003–0006, 0019–0023, 0053, 0125). `supabase/migrations/` is an empty dir.
- **Fix:** `delete:` Delete the orphan file and the empty dir. Optional: squash history into one baseline (`pg_dump --schema-only`) once all environments are on the latest migration; retire the replay/lineage checks with it.


## Claude skill set and workflow (3)

### SK-01 · P2 · effort S — ~95 Claude skills loaded, heavy overlap

- **Evidence:** gstack (~42), superpowers (17 incl. 2 deprecated), caveman (6, also copied into repo `skills/`), anthropic-skills (12), built-ins. Overlaps: code review ×6 (`review`, `code-review`, `code-review:code-review`, `caveman-review`, `superpowers:requesting-code-review`, `codex`); debugging ×2 (`investigate`, `superpowers:systematic-debugging`); browser ×5 (`browse`, `gstack`, `connect-chrome`, `open-gstack-browser`, `pair-agent`); brainstorm ×3 (`office-hours`, `superpowers:brainstorming`, `superpowers:brainstorm`); ship ×3 (`ship`, `land-and-deploy`, `superpowers:finishing-a-development-branch`); compress ×2 (`compress`, `caveman-compress`); safety ×4 (`careful`, `guard`, `freeze`, `unfreeze`). v2: `.agents/skills` vendors 33 skills (405 files, 123,203 lines) incl. `ponytail*` and `caveman*` already installed as plugins. `skills/` holds only empty dirs.
- **Fix:** `delete:` Keep one skill per job (see workflow). Delete the repo copy `.agents/` (405 files, 123k lines: 33 vendored skills incl. a second copy of Ponytail) and the empty `skills/` dirs; they duplicate installed plugins and Tailwind scans them (FE-04).
- *v1 fix (replaced by ponytail-review):* Keep one skill per job (see workflow below). Disable the rest per project in `.claude/settings.json`. Remove repo `skills/` copies (already installed globally) and the stale `brandkit` entry in `skills-lock.json`.

### SK-02 · P3 · effort S — CLAUDE.md routing table points to 30 skills

- **Evidence:** Every request is matched against a 30-line routing list, which adds context each turn and triggers overlapping skills.
- **Fix:** Shrink the table to the 10-skill workflow below.

### SK-03 · P3 · effort S — Ponytail plugin now installed — vendored copy duplicates it

- **Evidence:** Ponytail 4.10.0 plugin active (skills: ponytail, -audit, -debt, -gain, -review, -help). A second copy lives in `.agents/skills/ponytail*`.
- **Fix:** Delete the vendored copy (covered by SK-01). Use `/ponytail-audit` + `/ponytail-debt` as the cut step of every phase.

## Ponytail pass (v2)

ponytail-review of v1: 21 fixes replaced with a smaller one, 1 reversed (FE-03), 2 numbers corrected. Check of v2: 7 more fixes cut (MW-04, RSC-02 made consistent with MW-03; FE-09, FE-10, FE-15, INF-09, MW-06), 8 overlapping entries marked, page search trimmed (−35 KB).

- Re-measured production, Railway and pg_stat_statements: region still `ams`, 21 published tables, same latency profile; stats window starts 2026-01-16.
- Corrected DB-01: Realtime = 89% of DB time (144,318 s / 161,521 s), not >95%; non-Realtime total is ~17,200 s, not <10,000 s.
- Corrected DEAD-04: 53 root scratch files (+101 in scratch/), not 154.
- Reversed FE-03: the SVG sprite is itself 4.1 MB; use the existing per-icon files.
- SK-03: Ponytail is now installed; the vendored copy in `.agents/` duplicates it.
- Added 20 ranked Ponytail audit findings (PT-01..PT-20), the ponytail-debt ledger, and the gain card.
- Ponytail check of v2: 7 more fixes shortened, 8 overlapping PT entries labeled (95 unique issues), per-card search text removed from the page.
- v3 final audit: exact removal ledger (reachability + unused-export scans), full rename map with reference counts, live SQL inventory with rename/drop plan (56 indexes, 114 policies, 4 triggers, docs domain, 4 tables, 1 view, 1 function), and 30 scale mechanisms rated keep / cut / simplify.
- v3 corrections: dead files 53 (not 36) via reachability; legacy route strings 108 in 43 files (not ~50 in 26); `.agents/` 134,012 lines by line count (not 123,203).
- v4: steps A, B and C applied to local main (238 file changes, −11,742 / +62 lines), verified by typecheck, full unit suite (0 new failures) and ESLint; whole-app round-trip tables added; Docs tab items tracked with status.
- v5: implementation plan added — 11 phases, 47 tasks; coverage check maps all 356 report items to exactly one task, including the Docs database migration (T2.1) and deploy-before-drop (T1.1).

**ponytail-audit net: -232,580 lines, -9 deps possible** (v3 ledger: app code -13,796; vendored `.agents/` -134,012; generated catalog -22,473; sprite -20,259; clutter -42,028).

### ponytail-debt ledger

176 markers, 42 with no trigger.

**Stale or contradicted markers**

- `src/components/projects/tabs/ProjectSettingsTab.tsx:1219` "initial parallel eager fetch" → False. All 6 loaders are server actions; Next runs them one at a time (RSC-07).
- `src/lib/db/index.ts:69-71 + :104` force pooler 6543 "under 1M+ user load"; singleton → Speculative scale; the forced transaction pooler + 10 s idle timeout drive 117k type fetches (DB-02).
- `src/inngest/functions/flush-views.ts:9` "15-minute cron prevents polling churn" → Bypassed: `PROJECT_VIEWS_WRITE_THROUGH` is set in Railway, so every view writes directly (DB-08).
- `src/inngest/functions/notification-push-delivery.ts:42` "cuts idle checks by 80%" → Still 32,805 idle scans returning 16 rows total (DB-09).
- `middleware.ts:13` "remove / from auth resolution" → Lives in a file Next never builds (MW-01).
- `src/app/(main)/{discover,network,my-profile}/page.tsx:1` "re-export … without duplicating controller code" → The shortcut created the two-name problem (RT-01); no upgrade trigger.
- `src/app/api/v1/extension/session/route.ts:23` "avoid hammering DB with 1M heartbeats" → Speculative scale, no trigger. Fine to keep the cache; name a ceiling.

**no-trigger** (rot risk): `next.config.ts:22, :118`; `scripts/check-db-catalog-drift.ts:145`; `src/app/actions/subtask.ts:82`; `src/app/actions/project/_all.ts:8135, :8191`; `src/app/globals.css:700, :704, :711, :781`; `src/app/actions/task-comment.ts:258`; `src/app/actions/project/guidance.ts:366`; `src/app/actions/connections.ts:670`; `src/app/api/v1/github/account/replacement/route.ts:118`; `src/app/auth/callback/route.ts:214`; `src/app/api/v1/extension/session/route.ts:23, :50, :80`; `src/app/api/v1/projects/[id]/image/route.ts:59, :100`; `src/app/(main)/{discover,network,my-profile}/page.tsx:1`; `src/app/(main)/projects/[slug]/page.tsx:16`; `src/app/(main)/workspace/page.tsx:15`; `src/inngest/functions/sprint-schedule.ts:7`; `src/inngest/functions/notification-push-delivery.ts:42`; `src/inngest/functions/git-sync.ts:137`; `src/components/projects/v2/tasks/TaskCard.tsx:224`; `src/components/projects/tabs/sprint/SprintTimelineContent.tsx:158`; `src/components/layout/header/global-search.ts:118`; `src/components/projects/ProjectOnboardingModal.tsx:35`; `src/components/projects/dashboard/ProjectDashboardClient.tsx:230`; `src/components/projects/dashboard/InviteCollaboratorModal.tsx:96, :514`; `src/components/projects/tabs/ProjectSettingsTab.tsx:1219`; `src/components/workspace/WorkspaceTasksTab.tsx:315`; `src/components/projects/v2/tasks/KanbanBoard.tsx:829`; `src/components/workspace/WorkspaceRequestsTab.tsx:75`; `src/components/workspace/WorkspaceDrawerHost.tsx:61`; `src/components/profile/SocialPresenceIcon.tsx:142`; `src/lib/projects/social-links.ts:47`

### ponytail-gain

Benchmark medians from the plugin (5 tasks, 3 models), not this repo: lines of code -80–94%, cost -47–77%, 3–6x faster. No per-repo savings figure is claimed; the real per-repo numbers are the audit net and the debt ledger above.

## Minimal skill set and workflow

| Step | Skill | Use |
|---|---|---|
| Cut | `ponytail-audit + ponytail-debt` | Start every phase by listing what to delete; ledger any shortcut with ceiling + upgrade. |
| Plan | `superpowers:writing-plans` | One short plan per phase. Brainstorming only for new features. |
| Scope guard | `freeze` | Lock edits to the phase's folder. |
| Build | `ponytail (full) + superpowers:test-driven-development` | Smallest change; test first on SQL/query changes. |
| Debug | `investigate` | Only when a check fails. |
| Measure | `benchmark` | Before/after numbers for every phase. |
| Review | `ponytail-review, then review` | First cut complexity, then correctness. One reviewer each. |
| Ship | `ship → canary` | PR, deploy, watch production. |
| Talk | `caveman lite + caveman-commit` | Short status, short commits. |

Loop per phase: ponytail-audit → plan → freeze → build (smallest change, tests first) → benchmark → ponytail-review, then review → ship → canary. `benchmark` runs before and after each phase; reset `pg_stat_statements` after Phase 0.

## Execution plan

**Phase 0 — same day, config only**

- INF-01 move web+worker to Singapore
- DB-02 pool settings
- DB-01 step 1 drop 5 tables from publication
- DB-04 credential scrub WHERE
- DB-08 unset write-through
- DB-11 drop duplicate index
- FE-04 Tailwind source()
- INF-02 co-locate Redis

**Phase 1 — correctness and security**

- MW-01 single proxy
- MW-02 matcher
- MW-08 CSP hosts
- DB-15 RLS initplan
- DB-17 advisor fixes
- INF-06 deploy from main

**Phase 2 — rename and delete (Ponytail)**

- RT-01 one name per page
- RT-02..05 aliases, completion, hidden pages, empty dirs
- PT-01 .agents
- PT-02/03 catalog + sprite
- PT-04 dead files
- PT-05 scale tooling
- PT-06 flags
- PT-07 telemetry
- PT-08 load shedding
- PT-13 packages
- PT-16..20 env, icons, lockfiles

**Phase 3 — SQL**

- DB-03 partial indexes
- DB-05 events index
- DB-07 presence table
- DB-09 event-driven crons
- DB-10 catalog hash
- DB-12 FK indexes
- DB-14 counters
- DB-18 badge counts
- DB-20 batch N+1
- DB-01 step 2 Broadcast

**Phase 4 — render path**

- RSC-01 static legal group
- INF-04 edge cache
- RSC-02 parallel reads
- RSC-03 streaming shell
- MW-03 onboarding check in layout
- RSC-07 one action per screen
- RSC-06 delete dead revalidatePath

**Phase 5 — client weight**

- FE-01 slim root
- FE-03 sprite icons
- FE-02 auth islands
- FE-05 split big components
- FE-06..12 providers, memo, timers, invalidation
- FE-07 React Compiler

## Not measured / caveats

- INP, TBT, TTI, hydration time, re-render counts and component mount times on signed-in routes (/workspace, /projects/[slug], /messages) were not measured: that needs a signed-in session, and I do not enter passwords. Sign in inside the app's browser pane and I can take these with the Performance API and React Profiler.
- FCP/LCP paint entries were empty because the browser pane was hidden during the lab run; TTFB/DCL/load and transfer sizes above are real. Speed Index needs a Lighthouse run.
- Per-route JS sizes come from the Sep 23 local build's client-reference manifests (upper bound: they include lazily loaded chunks).
- `pg_stat_statements` totals are cumulative since the last stats reset, not a fixed window.
- No destructive change was made: no files deleted, no SQL run except read-only stats queries.
