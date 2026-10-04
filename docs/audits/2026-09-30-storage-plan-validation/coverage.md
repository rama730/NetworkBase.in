# Repository coverage inventory

This is the initial snapshot. [The concurrent-change inventory](concurrent-delta.json) extends it to the handoff cutoff and includes the additional SQL migration and source files. The plan explains which concurrent changes were manually reviewed and which remain regression targets.

Date: 2026-09-30. This is a full-text discovery index, not certification that every line was manually reviewed. See the implementation plan for findings, inspected boundaries and acceptance work. The JSON contains exact file hashes and matching line numbers. New or changed files require another scan.

Commit: `7e379903aa4690358948a536f454ce0c711fd30b`; the existing working-tree changes are included.

## Counts

- source_files: 996
- sql_files: 174
- sql_lines: 58072
- source_match_files: {'storage_reference': 128, 'sql_query_surface': 260, 'storage_operation': 41}
- inventory_files: 1757
- source_routes_and_pages: 117

## Every source folder

| Folder | Files | Lines | Storage matches | SQL/query matches |
|---|---:|---:|---:|---:|
| `src` | 1 | 216 | 0 | 1 |
| `src/app` | 7 | 1355 | 0 | 0 |
| `src/app/(legal)` | 1 | 13 | 0 | 0 |
| `src/app/(legal)/acceptable-use` | 1 | 18 | 0 | 0 |
| `src/app/(legal)/cookies` | 1 | 17 | 0 | 0 |
| `src/app/(legal)/copyright` | 1 | 17 | 0 | 0 |
| `src/app/(legal)/dpa` | 1 | 21 | 0 | 0 |
| `src/app/(legal)/eula` | 1 | 24 | 0 | 0 |
| `src/app/(legal)/grievances` | 1 | 19 | 0 | 0 |
| `src/app/(legal)/open-source` | 1 | 15 | 0 | 0 |
| `src/app/(legal)/privacy` | 1 | 43 | 0 | 0 |
| `src/app/(legal)/security-reporting` | 1 | 17 | 0 | 0 |
| `src/app/(legal)/subprocessors` | 1 | 28 | 0 | 0 |
| `src/app/(legal)/terms` | 1 | 32 | 0 | 0 |
| `src/app/(site)` | 3 | 64 | 0 | 0 |
| `src/app/(site)/(auth)` | 2 | 43 | 0 | 0 |
| `src/app/(site)/(auth)/authorize` | 2 | 904 | 0 | 0 |
| `src/app/(site)/(auth)/forgot-password` | 1 | 170 | 0 | 0 |
| `src/app/(site)/(auth)/login` | 1 | 19 | 0 | 0 |
| `src/app/(site)/(auth)/reset-password` | 1 | 261 | 0 | 0 |
| `src/app/(site)/(auth)/signup` | 1 | 19 | 0 | 0 |
| `src/app/(site)/(auth)/verify-email` | 1 | 164 | 0 | 0 |
| `src/app/(site)/(main)` | 2 | 89 | 0 | 0 |
| `src/app/(site)/(main)/discover` | 2 | 99 | 0 | 0 |
| `src/app/(site)/(main)/messages` | 2 | 70 | 0 | 0 |
| `src/app/(site)/(main)/my-profile` | 2 | 122 | 0 | 0 |
| `src/app/(site)/(main)/network` | 2 | 41 | 0 | 0 |
| `src/app/(site)/(main)/projects/[slug]` | 2 | 230 | 0 | 0 |
| `src/app/(site)/(main)/projects/new` | 2 | 59 | 0 | 0 |
| `src/app/(site)/(main)/settings` | 3 | 54 | 0 | 0 |
| `src/app/(site)/(main)/u/[username]` | 2 | 127 | 0 | 0 |
| `src/app/(site)/(main)/workspace` | 1 | 17 | 0 | 0 |
| `src/app/(site)/(onboarding)` | 2 | 102 | 0 | 1 |
| `src/app/(site)/(onboarding)/onboarding` | 1 | 1139 | 1 | 0 |
| `src/app/(site)/admin/notifications` | 1 | 281 | 0 | 1 |
| `src/app/(site)/legal/accept` | 1 | 69 | 0 | 0 |
| `src/app/.well-known/security.txt` | 1 | 23 | 0 | 0 |
| `src/app/actions` | 21 | 12276 | 5 | 20 |
| `src/app/actions/applications` | 3 | 4109 | 0 | 1 |
| `src/app/actions/files` | 8 | 3464 | 5 | 7 |
| `src/app/actions/matchmaking` | 1 | 140 | 0 | 1 |
| `src/app/actions/messaging` | 5 | 7443 | 1 | 5 |
| `src/app/actions/project` | 6 | 13840 | 3 | 6 |
| `src/app/api` | 1 | 40 | 0 | 0 |
| `src/app/api/e2e/auth` | 1 | 254 | 0 | 0 |
| `src/app/api/inngest` | 1 | 8 | 0 | 0 |
| `src/app/api/og/project/[slug]` | 1 | 114 | 0 | 0 |
| `src/app/api/v1` | 3 | 393 | 0 | 1 |
| `src/app/api/v1/account/delete` | 1 | 219 | 0 | 0 |
| `src/app/api/v1/account/export` | 1 | 95 | 0 | 0 |
| `src/app/api/v1/account/reserved-usernames` | 1 | 275 | 0 | 1 |
| `src/app/api/v1/appearance` | 1 | 196 | 0 | 0 |
| `src/app/api/v1/auth/change-password` | 1 | 330 | 0 | 0 |
| `src/app/api/v1/auth/mfa/factors/[id]` | 1 | 292 | 0 | 1 |
| `src/app/api/v1/auth/mfa/recovery-codes` | 1 | 278 | 0 | 1 |
| `src/app/api/v1/auth/password-safety` | 1 | 61 | 0 | 0 |
| `src/app/api/v1/auth/security-step-up` | 1 | 462 | 0 | 1 |
| `src/app/api/v1/auth/session` | 1 | 246 | 0 | 0 |
| `src/app/api/v1/auth/signup` | 1 | 355 | 0 | 0 |
| `src/app/api/v1/auth/verify-email` | 1 | 99 | 0 | 0 |
| `src/app/api/v1/cleanup-orphan` | 1 | 58 | 0 | 0 |
| `src/app/api/v1/extension` | 2 | 186 | 1 | 2 |
| `src/app/api/v1/extension/auth-code` | 1 | 184 | 0 | 1 |
| `src/app/api/v1/extension/bulk-finalize` | 1 | 238 | 1 | 1 |
| `src/app/api/v1/extension/bulk-intent` | 1 | 117 | 1 | 1 |
| `src/app/api/v1/extension/file` | 1 | 415 | 1 | 1 |
| `src/app/api/v1/extension/file-lock` | 1 | 166 | 0 | 1 |
| `src/app/api/v1/extension/file-upload` | 1 | 407 | 1 | 1 |
| `src/app/api/v1/extension/folder` | 1 | 162 | 1 | 1 |
| `src/app/api/v1/extension/heartbeat` | 1 | 108 | 0 | 1 |
| `src/app/api/v1/extension/project-summary` | 1 | 102 | 0 | 1 |
| `src/app/api/v1/extension/project-tasks` | 1 | 147 | 0 | 1 |
| `src/app/api/v1/extension/recovery-drafts` | 1 | 418 | 1 | 1 |
| `src/app/api/v1/extension/recovery-sessions` | 1 | 159 | 0 | 1 |
| `src/app/api/v1/extension/session` | 1 | 144 | 0 | 1 |
| `src/app/api/v1/extension/task-detail` | 1 | 133 | 1 | 1 |
| `src/app/api/v1/extension/task-push` | 1 | 142 | 0 | 1 |
| `src/app/api/v1/extension/workspace` | 1 | 265 | 1 | 1 |
| `src/app/api/v1/files/[nodeId]/lock` | 1 | 80 | 0 | 0 |
| `src/app/api/v1/files/[nodeId]/lock-renew` | 1 | 44 | 0 | 0 |
| `src/app/api/v1/files/locks` | 1 | 26 | 0 | 0 |
| `src/app/api/v1/github/account/replacement` | 1 | 151 | 0 | 0 |
| `src/app/api/v1/github/import/abort` | 1 | 141 | 1 | 1 |
| `src/app/api/v1/github/import/access-state` | 1 | 61 | 0 | 0 |
| `src/app/api/v1/github/import/analyze` | 1 | 28 | 0 | 0 |
| `src/app/api/v1/github/import/batch-file-intent` | 1 | 203 | 1 | 1 |
| `src/app/api/v1/github/import/branches` | 1 | 30 | 0 | 0 |
| `src/app/api/v1/github/import/file-intent` | 1 | 140 | 1 | 1 |
| `src/app/api/v1/github/import/finalize-file` | 1 | 234 | 1 | 1 |
| `src/app/api/v1/github/import/finalize-manifest` | 1 | 141 | 1 | 1 |
| `src/app/api/v1/github/import/init` | 1 | 93 | 1 | 1 |
| `src/app/api/v1/github/import/preflight` | 1 | 29 | 0 | 0 |
| `src/app/api/v1/github/import/preview-folder` | 1 | 30 | 0 | 0 |
| `src/app/api/v1/github/import/preview-root` | 1 | 29 | 0 | 0 |
| `src/app/api/v1/github/import/repositories` | 1 | 34 | 0 | 0 |
| `src/app/api/v1/github/import/status` | 1 | 136 | 0 | 1 |
| `src/app/api/v1/health` | 1 | 107 | 0 | 1 |
| `src/app/api/v1/integrations` | 1 | 106 | 0 | 1 |
| `src/app/api/v1/legal/acceptance` | 1 | 25 | 0 | 0 |
| `src/app/api/v1/link-preview` | 1 | 344 | 0 | 0 |
| `src/app/api/v1/live` | 1 | 17 | 0 | 0 |
| `src/app/api/v1/messages/attachments/[attachmentId]` | 1 | 295 | 1 | 1 |
| `src/app/api/v1/messages/attachments/presign` | 1 | 270 | 1 | 1 |
| `src/app/api/v1/onboarding/username-check` | 1 | 108 | 0 | 0 |
| `src/app/api/v1/presence/heartbeat` | 1 | 52 | 0 | 0 |
| `src/app/api/v1/privacy` | 2 | 239 | 0 | 0 |
| `src/app/api/v1/privacy/blocks` | 1 | 76 | 0 | 0 |
| `src/app/api/v1/privacy/blocks/[userId]` | 1 | 58 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/collaboration-stages/[stageId]` | 1 | 17 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/collaboration-summary` | 1 | 87 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/contributions` | 1 | 72 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/project-invite-options` | 1 | 62 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/project-invites` | 1 | 125 | 0 | 0 |
| `src/app/api/v1/profiles/[id]/projects` | 1 | 88 | 0 | 0 |
| `src/app/api/v1/projects` | 1 | 303 | 0 | 0 |
| `src/app/api/v1/projects/[id]/capabilities` | 1 | 77 | 0 | 0 |
| `src/app/api/v1/projects/[id]/files/[nodeId]/preview` | 1 | 105 | 1 | 1 |
| `src/app/api/v1/projects/[id]/image` | 1 | 110 | 1 | 1 |
| `src/app/api/v1/projects/[id]/members` | 1 | 190 | 0 | 1 |
| `src/app/api/v1/projects/[id]/sync-diff` | 1 | 145 | 0 | 1 |
| `src/app/api/v1/projects/[id]/tasks/[taskId]/merge` | 1 | 100 | 0 | 0 |
| `src/app/api/v1/projects/[id]/update-media` | 1 | 83 | 1 | 1 |
| `src/app/api/v1/ready` | 1 | 18 | 0 | 0 |
| `src/app/api/v1/security` | 1 | 129 | 0 | 0 |
| `src/app/api/v1/security/csrf` | 1 | 50 | 0 | 0 |
| `src/app/api/v1/sessions` | 1 | 376 | 0 | 0 |
| `src/app/api/v1/skills` | 1 | 65 | 0 | 0 |
| `src/app/api/v1/skills/proposals` | 1 | 73 | 0 | 1 |
| `src/app/api/v1/skills/resolve` | 1 | 30 | 0 | 0 |
| `src/app/api/v1/webhooks/github` | 1 | 171 | 0 | 1 |
| `src/app/auth/callback` | 1 | 250 | 0 | 1 |
| `src/app/fonts` | 7 | 288 | 0 | 0 |
| `src/app/go/[ownerType]/[ownerId]/[linkKey]` | 1 | 122 | 0 | 1 |
| `src/components/auth` | 8 | 2906 | 0 | 0 |
| `src/components/brand` | 1 | 69 | 0 | 0 |
| `src/components/chat` | 2 | 170 | 0 | 0 |
| `src/components/chat/v2` | 32 | 8890 | 1 | 6 |
| `src/components/discover` | 5 | 949 | 1 | 0 |
| `src/components/layout` | 2 | 218 | 1 | 0 |
| `src/components/layout/header` | 14 | 2332 | 0 | 0 |
| `src/components/legal` | 2 | 98 | 0 | 0 |
| `src/components/links` | 1 | 137 | 0 | 0 |
| `src/components/network` | 10 | 1461 | 0 | 0 |
| `src/components/notifications` | 3 | 693 | 0 | 1 |
| `src/components/onboarding` | 10 | 1008 | 0 | 3 |
| `src/components/onboarding/__tests__` | 14 | 4892 | 1 | 0 |
| `src/components/onboarding/steps` | 4 | 980 | 1 | 0 |
| `src/components/privacy` | 3 | 272 | 0 | 0 |
| `src/components/profile` | 1 | 158 | 0 | 0 |
| `src/components/profile/edit` | 2 | 1715 | 1 | 0 |
| `src/components/profile/v2` | 10 | 1980 | 0 | 0 |
| `src/components/profile/v2/sections` | 5 | 578 | 0 | 0 |
| `src/components/projects` | 10 | 1537 | 0 | 1 |
| `src/components/projects/create-wizard` | 7 | 1501 | 2 | 1 |
| `src/components/projects/create-wizard/phase1` | 5 | 424 | 0 | 1 |
| `src/components/projects/create-wizard/phases` | 5 | 2670 | 1 | 1 |
| `src/components/projects/dashboard` | 11 | 4526 | 3 | 3 |
| `src/components/projects/doc` | 7 | 1825 | 0 | 1 |
| `src/components/projects/settings` | 12 | 3977 | 1 | 0 |
| `src/components/projects/skeletons` | 7 | 233 | 0 | 3 |
| `src/components/projects/tabs` | 5 | 3873 | 0 | 1 |
| `src/components/projects/tabs/sprint` | 4 | 1178 | 0 | 0 |
| `src/components/projects/updates` | 9 | 3808 | 3 | 2 |
| `src/components/projects/v2` | 1 | 1042 | 0 | 0 |
| `src/components/projects/v2/explorer` | 13 | 4438 | 3 | 6 |
| `src/components/projects/v2/explorer/utils` | 3 | 316 | 1 | 2 |
| `src/components/projects/v2/files-tab` | 20 | 9258 | 3 | 3 |
| `src/components/projects/v2/files-tab/breadcrumb` | 1 | 511 | 1 | 0 |
| `src/components/projects/v2/files-tab/file` | 11 | 3854 | 4 | 1 |
| `src/components/projects/v2/files-tab/folder` | 8 | 2340 | 1 | 2 |
| `src/components/projects/v2/files-tab/github-sync` | 4 | 220 | 0 | 0 |
| `src/components/projects/v2/files-tab/hooks` | 7 | 1274 | 0 | 0 |
| `src/components/projects/v2/files-tab/picker` | 4 | 971 | 0 | 0 |
| `src/components/projects/v2/files-tab/quick-open` | 1 | 393 | 0 | 0 |
| `src/components/projects/v2/files-tab/upload` | 1 | 802 | 1 | 0 |
| `src/components/projects/v2/preview` | 2 | 378 | 1 | 0 |
| `src/components/projects/v2/sprints` | 1 | 499 | 0 | 0 |
| `src/components/projects/v2/tasks` | 5 | 2687 | 0 | 0 |
| `src/components/projects/v2/tasks/TaskDetailTabs` | 4 | 3040 | 1 | 1 |
| `src/components/projects/v2/tasks/badges` | 2 | 44 | 0 | 0 |
| `src/components/projects/v2/tasks/components` | 9 | 2879 | 2 | 0 |
| `src/components/projects/v2/utils` | 1 | 154 | 0 | 0 |
| `src/components/providers` | 9 | 1668 | 1 | 1 |
| `src/components/settings` | 18 | 2520 | 0 | 0 |
| `src/components/settings/ui` | 6 | 216 | 0 | 0 |
| `src/components/skills` | 5 | 681 | 0 | 0 |
| `src/components/ui` | 25 | 2406 | 1 | 0 |
| `src/components/workspace` | 4 | 1110 | 1 | 1 |
| `src/constants` | 4 | 101 | 0 | 0 |
| `src/hooks` | 36 | 9452 | 5 | 12 |
| `src/hooks/discover` | 3 | 287 | 1 | 1 |
| `src/hooks/mutations` | 1 | 30 | 0 | 0 |
| `src/hooks/projects` | 4 | 369 | 0 | 2 |
| `src/inngest` | 3 | 210 | 2 | 0 |
| `src/inngest/functions` | 26 | 3247 | 10 | 22 |
| `src/lib` | 10 | 738 | 1 | 1 |
| `src/lib/account` | 1 | 223 | 0 | 1 |
| `src/lib/applications` | 4 | 169 | 0 | 0 |
| `src/lib/audit` | 1 | 76 | 0 | 0 |
| `src/lib/auth` | 12 | 1365 | 0 | 3 |
| `src/lib/chat` | 5 | 275 | 0 | 0 |
| `src/lib/connections` | 1 | 100 | 0 | 1 |
| `src/lib/data` | 3 | 1961 | 0 | 3 |
| `src/lib/db` | 3 | 184 | 0 | 2 |
| `src/lib/db/schema` | 1 | 5814 | 1 | 1 |
| `src/lib/discover` | 3 | 61 | 0 | 0 |
| `src/lib/e2e` | 1 | 76 | 0 | 1 |
| `src/lib/extension` | 9 | 981 | 3 | 4 |
| `src/lib/files` | 18 | 2674 | 4 | 8 |
| `src/lib/github` | 25 | 5179 | 5 | 10 |
| `src/lib/import` | 3 | 346 | 1 | 1 |
| `src/lib/legal` | 3 | 278 | 0 | 1 |
| `src/lib/links` | 1 | 44 | 0 | 0 |
| `src/lib/messages` | 27 | 3546 | 1 | 5 |
| `src/lib/metadata` | 1 | 75 | 0 | 0 |
| `src/lib/notifications` | 16 | 4516 | 1 | 9 |
| `src/lib/onboarding` | 8 | 416 | 1 | 1 |
| `src/lib/performance` | 1 | 419 | 0 | 0 |
| `src/lib/privacy` | 10 | 1203 | 1 | 5 |
| `src/lib/profile` | 9 | 2826 | 1 | 4 |
| `src/lib/projects` | 46 | 9071 | 4 | 12 |
| `src/lib/realtime` | 6 | 1117 | 1 | 1 |
| `src/lib/routing` | 3 | 176 | 1 | 0 |
| `src/lib/search` | 3 | 110 | 0 | 0 |
| `src/lib/security` | 21 | 2561 | 0 | 6 |
| `src/lib/server` | 1 | 157 | 0 | 1 |
| `src/lib/services` | 4 | 301 | 0 | 1 |
| `src/lib/settings` | 1 | 138 | 0 | 0 |
| `src/lib/skills` | 13 | 12179 | 0 | 1 |
| `src/lib/standards` | 2 | 94 | 0 | 0 |
| `src/lib/state` | 1 | 34 | 0 | 0 |
| `src/lib/storage` | 2 | 197 | 0 | 0 |
| `src/lib/supabase` | 7 | 738 | 1 | 1 |
| `src/lib/theme` | 3 | 446 | 1 | 0 |
| `src/lib/ui` | 3 | 110 | 0 | 0 |
| `src/lib/upload` | 6 | 1167 | 4 | 3 |
| `src/lib/usernames` | 1 | 372 | 0 | 1 |
| `src/lib/utils` | 12 | 639 | 2 | 3 |
| `src/lib/validations` | 9 | 950 | 1 | 1 |
| `src/lib/view-models` | 2 | 152 | 0 | 0 |
| `src/lib/workspace` | 3 | 195 | 0 | 2 |
| `src/stores` | 4 | 528 | 1 | 1 |
| `src/stores/files` | 8 | 1868 | 2 | 1 |
| `src/styles` | 1 | 324 | 0 | 0 |
| `src/types` | 2 | 355 | 0 | 0 |
| `src/workers` | 1 | 55 | 0 | 0 |

## Every SQL file

Applied SQL is immutable history. Seed data is scanned and fingerprinted; it is not all executable runtime logic. Counts alone do not prove deployed parity.

| File | Lines | SHA-256 (first 12) |
|---|---:|---|
| `drizzle/0000_medical_the_liberteens.sql` | 75 | `399ccb3257e3` |
| `drizzle/0001_remarkable_mattie_franklin.sql` | 17 | `5063ce8169b6` |
| `drizzle/0002_spotty_paladin.sql` | 1 | `87e91c5ef4a1` |
| `drizzle/0003_ambitious_skin.sql` | 164 | `c9db93ef196f` |
| `drizzle/0003_messaging.sql` | 281 | `4dbffeeb12aa` |
| `drizzle/0004_chat_storage.sql` | 77 | `83a1466b49ef` |
| `drizzle/0004_harsh_randall.sql` | 75 | `12cc63b5ee8b` |
| `drizzle/0004_message_reactions.sql` | 125 | `15d2b13b5e36` |
| `drizzle/0005_enable_connections_realtime.sql` | 2 | `a8f5b8736681` |
| `drizzle/0005_spooky_romulus.sql` | 5 | `f45fb9770bd0` |
| `drizzle/0006_furry_susan_delgado.sql` | 51 | `b1b903f287ca` |
| `drizzle/0006_messages_performance_indexes.sql` | 94 | `1dc3f24f8aaa` |
| `drizzle/0007_typing_indicators.sql` | 74 | `b6f23feadec1` |
| `drizzle/0008_task_features.sql` | 223 | `2fcf1e448c55` |
| `drizzle/0009_fix_rls_policies.sql` | 136 | `eb4006999980` |
| `drizzle/0013_task_node_links.sql` | 18 | `fc2a15601beb` |
| `drizzle/0014_project_file_index.sql` | 41 | `1c148bcf780b` |
| `drizzle/0015_project_node_locks.sql` | 49 | `c9af067f6dee` |
| `drizzle/0016_project_nodes_trash_and_events.sql` | 71 | `1ce1821d358e` |
| `drizzle/0017_drop_task_files.sql` | 5 | `e3d3b1ea051e` |
| `drizzle/0018_role_applications_message_and_constraints.sql` | 39 | `a0196e1748ed` |
| `drizzle/0019_demonic_bloodscream.sql` | 2 | `b8de298bf1d3` |
| `drizzle/0019_messaging_rls_and_realtime.sql` | 141 | `46035f96c86b` |
| `drizzle/0020_damp_shatterstar.sql` | 231 | `26f8d41308bf` |
| `drizzle/0020_dm_pairs.sql` | 22 | `3f3316e9ee20` |
| `drizzle/0021_add_project_conversation_id.sql` | 10 | `0c0d37fbc055` |
| `drizzle/0021_faithful_warstar.sql` | 17 | `ce961bf94d00` |
| `drizzle/0022_handy_tombstone.sql` | 34 | `22beaab67099` |
| `drizzle/0022_messaging_reliability_and_scale.sql` | 131 | `ddec69c98441` |
| `drizzle/0023_little_quasimodo.sql` | 106 | `f16723a18141` |
| `drizzle/0023_message_attachments_storage_path.sql` | 23 | `d46cb12930ff` |
| `drizzle/0024_attachment_upload_sessions.sql` | 32 | `95db310abdff` |
| `drizzle/0025_message_actions_edit_delete.sql` | 36 | `a67078c07272` |
| `drizzle/0026_project_members_unique.sql` | 21 | `966b2f150e0f` |
| `drizzle/0027_task_node_links_unique.sql` | 23 | `cd3b902eda48` |
| `drizzle/0028_project_follow_counts.sql` | 45 | `e45d140145bf` |
| `drizzle/0029_workspace_layout.sql` | 6 | `63143014aac6` |
| `drizzle/0030_message_reply_and_preview.sql` | 32 | `64e4edc919cf` |
| `drizzle/0031_connection_suggestion_dismissals.sql` | 32 | `2a06e0c111fe` |
| `drizzle/0032_project_runner_sessions.sql` | 175 | `e001078ece9d` |
| `drizzle/0033_onboarding_username_guardrails.sql` | 73 | `d2422cd5b023` |
| `drizzle/0034_onboarding_reliability_and_telemetry.sql` | 119 | `0bb2d3ca6c78` |
| `drizzle/0035_onboarding_submission_integrity.sql` | 280 | `d0c60c4db646` |
| `drizzle/0036_onboarding_claims_repair_queue.sql` | 5 | `993159a97de4` |
| `drizzle/0037_onboarding_submissions_updated_at_trigger.sql` | 29 | `efa406db3fc3` |
| `drizzle/0038_profile_audit_events.sql` | 18 | `ae625aadeec5` |
| `drizzle/0039_files_workspace_scale_indexes.sql` | 52 | `97c6ae0a4625` |
| `drizzle/0040_projects_github_columns.sql` | 29 | `b99ffc274ad5` |
| `drizzle/0041_username_rules_schema_qualification.sql` | 23 | `231a2fc11199` |
| `drizzle/0042_schema_hardening_constraints_and_fks.sql` | 204 | `8e0be57fa106` |
| `drizzle/0043_project_files_key_policy_dual_read.sql` | 101 | `5a5092acea6e` |
| `drizzle/0044_onboarding_profile_extended_preferences.sql` | 70 | `62044f68f098` |
| `drizzle/0051_clever_scarecrow.sql` | 137 | `07973b7b7c18` |
| `drizzle/0052_workspace_profile_counters.sql` | 71 | `90938a01cba9` |
| `drizzle/0053_database_partitioning.sql` | 106 | `071e7517ec9c` |
| `drizzle/0053_security_recovery_codes.sql` | 3 | `64f89c031670` |
| `drizzle/0054_privacy_system_foundation.sql` | 59 | `5299cfbcc87a` |
| `drizzle/0055_workspace_profile_counters_table.sql` | 52 | `3d690caba9bb` |
| `drizzle/0056_username_aliases_and_exact_lookup_cleanup.sql` | 42 | `d2eeffb6784e` |
| `drizzle/0057_username_index_dedup_cleanup.sql` | 4 | `6fe8e450acc3` |
| `drizzle/0058_connection_suggestions.sql` | 36 | `133048ac376e` |
| `drizzle/0059_messaging_reactions_reports_receipts.sql` | 153 | `012a9ab87c57` |
| `drizzle/0060_messaging_collaboration_foundation.sql` | 503 | `219718b4e296` |
| `drizzle/0061_profile_security_state_privacy_rls.sql` | 99 | `01c59a9bf84b` |
| `drizzle/0062_upload_intents_and_recovery_redemptions.sql` | 101 | `fb7454ec05b4` |
| `drizzle/0063_database_setup_authority_backfill.sql` | 755 | `749fdf5593ac` |
| `drizzle/0064_messaging_reactions_reports_receipts_rls.sql` | 136 | `bdca1eee72c1` |
| `drizzle/0065_profile_security_recovery_factor_binding.sql` | 24 | `d6366c29f12f` |
| `drizzle/0066_message_delivery_receipts.sql` | 125 | `2cddb9153bb6` |
| `drizzle/0067_read_receipts_conversation_id.sql` | 86 | `342ad472259d` |
| `drizzle/0068_file_versions.sql` | 141 | `50e1c6ac3bd8` |
| `drizzle/0069_project_nodes_current_version.sql` | 43 | `c64cd49dd8fa` |
| `drizzle/0070_comment_mentions.sql` | 105 | `5ab4cf655afd` |
| `drizzle/0071_realtime_publication_extension.sql` | 25 | `d15f208a565c` |
| `drizzle/0072_user_notifications.sql` | 567 | `058d127b3327` |
| `drizzle/0073_message_reactions_conversation_scope.sql` | 30 | `9e50306e343f` |
| `drizzle/0074_v2_schema_optimizations.sql` | 251 | `556f5ee3c927` |
| `drizzle/0075_review_optimization_indexes.sql` | 80 | `28ab2b445d75` |
| `drizzle/0076_profile_collaboration_projection.sql` | 186 | `8af8231aeda9` |
| `drizzle/0077_profile_collaboration_role_stages.sql` | 131 | `95adaa5c0e9a` |
| `drizzle/0078_public_rls_security_hardening.sql` | 898 | `ad6d0d5113c9` |
| `drizzle/0079_profile_column_privilege_hardening.sql` | 43 | `234a863e7e35` |
| `drizzle/0080_profile_write_privilege_hardening.sql` | 40 | `175ae55d0741` |
| `drizzle/0081_project_updates_realtime.sql` | 42 | `f82edb05bd6e` |
| `drizzle/0082_project_update_drafts.sql` | 32 | `6a935f5a0128` |
| `drizzle/0083_project_update_drafts_rls.sql` | 53 | `d2e45d9028e3` |
| `drizzle/0084_team_invite_collaboration_status.sql` | 5 | `9a193ad85436` |
| `drizzle/0085_project_update_media_storage.sql` | 103 | `7b3a89b44283` |
| `drizzle/0086_virtual_workspace_fields.sql` | 164 | `7b6f6fafff4f` |
| `drizzle/0087_non_transactional_indexes.sql` | 36 | `d1fe56e5ef06` |
| `drizzle/0088_extension_device_session_editor_metadata.sql` | 8 | `137d2660a03e` |
| `drizzle/0089_project_node_event_sequence_trigger.sql` | 41 | `5588555bde02` |
| `drizzle/0090_project_update_comment_threads.sql` | 41 | `27cb60efe708` |
| `drizzle/0091_extension_auth_code_events.sql` | 24 | `e5a523c78f82` |
| `drizzle/0092_project_updates_performance_indexes.sql` | 17 | `e8bf7f672f89` |
| `drizzle/0094_lovely_toad.sql` | 14 | `a35b1786dca7` |
| `drizzle/0095_docs_hub_upgrade.sql` | 140 | `dd6606991ced` |
| `drizzle/0098_onboarding_state_machine.sql` | 74 | `9d080b979116` |
| `drizzle/0099_schema_lineage_and_fk_indexes.sql` | 131 | `50b9f7ca0306` |
| `drizzle/0100_extension_recovery_drafts.sql` | 79 | `3e15d314cc4a` |
| `drizzle/0101_project_file_leases.sql` | 96 | `4311156decd3` |
| `drizzle/0102_extension_recovery_sessions.sql` | 31 | `c16f5d48bf6b` |
| `drizzle/0103_market_skill_catalog.sql` | 265 | `fd6762feaa27` |
| `drizzle/0104_market_skill_seed.sql` | 1883 | `b8743040788d` |
| `drizzle/0105_market_skill_catalog_1_0_1.sql` | 1894 | `c01f726630db` |
| `drizzle/0106_role_skill_visibility_hardening.sql` | 25 | `a9f907721668` |
| `drizzle/0107_market_skill_catalog_1_1_0.sql` | 3413 | `fa0fc2c4173a` |
| `drizzle/0108_market_skill_icons_1_2_0.sql` | 3484 | `0675ee652c42` |
| `drizzle/0109_skill_catalog_fk_indexes.sql` | 15 | `96475b11a395` |
| `drizzle/0110_market_skill_icons_1_2_1.sql` | 3519 | `b2fec35189af` |
| `drizzle/0111_market_skill_catalog_1_3_0.sql` | 3866 | `5b0124ffd4b9` |
| `drizzle/0112_market_skill_catalog_1_3_1.sql` | 3866 | `5669daad8b24` |
| `drizzle/0113_market_skill_catalog_1_3_2.sql` | 3902 | `8e80c5f1e08c` |
| `drizzle/0114_market_skill_catalog_1_3_3.sql` | 4284 | `2bc069299328` |
| `drizzle/0115_market_skill_catalog_1_3_4.sql` | 4284 | `be2c8831f53c` |
| `drizzle/0116_market_skill_catalog_1_3_5.sql` | 4283 | `50c55518f949` |
| `drizzle/0117_market_skill_catalog_1_3_6.sql` | 4353 | `ab2bb1ad77ec` |
| `drizzle/0118_remove_profile_availability_status.sql` | 22 | `f503a03038ad` |
| `drizzle/0119_open_roles_ecosystem.sql` | 58 | `10a397b1b2db` |
| `drizzle/0120_ponytail_message_system_cleanup.sql` | 42 | `8fd907256630` |
| `drizzle/0121_ponytail_skill_catalog_table_cleanup.sql` | 23 | `8761e8b68617` |
| `drizzle/0122_ponytail_database_hardening.sql` | 971 | `2530375f1968` |
| `drizzle/0123_ponytail_duplicate_index_completion.sql` | 6 | `b908b68bcd20` |
| `drizzle/0124_ponytail_storage_bucket_contracts.sql` | 32 | `e5523a1ac3b3` |
| `drizzle/0125_ponytail_allow_office_mimes.sql` | 25 | `deefedd4f31e` |
| `drizzle/0125_ponytail_realtime_publication_trim.sql` | 26 | `dca7bb951686` |
| `drizzle/0126_extension_session_disconnect_callback.sql` | 2 | `d7a7ae36c258` |
| `drizzle/0127_profile_contribution_authority.sql` | 268 | `d6b3eb343a28` |
| `drizzle/0128_notification_activity_state_contract.sql` | 25 | `a0fc5d450ce0` |
| `drizzle/0129_messages_data_authority.sql` | 1273 | `8d69f2e49d7b` |
| `drizzle/0130_messages_fk_support_indexes.sql` | 16 | `df94edf28c71` |
| `drizzle/0131_messages_native_payload_contract.sql` | 48 | `8dbd8641172e` |
| `drizzle/0132_message_notification_preview_redaction.sql` | 5 | `5f329c65a0e4` |
| `drizzle/0133_message_preview_lifecycle.sql` | 124 | `1172493440a9` |
| `drizzle/0134_message_reaction_activity.sql` | 49 | `adf0cde9b688` |
| `drizzle/0135_project_custom_workflow.sql` | 12 | `aa082a3e84ad` |
| `drizzle/0136_task_board_read_index.sql` | 3 | `e19ba7dc4e26` |
| `drizzle/0137_task_activity_events.sql` | 14 | `f2e49b82d9d7` |
| `drizzle/0138_task_activity_actor_index.sql` | 2 | `f0e66b68c5ef` |
| `drizzle/0139_project_workflow_columns.sql` | 35 | `f7917a3e23c9` |
| `drizzle/0140_project_workflow_defaults_trigger.sql` | 20 | `b7920e29ea24` |
| `drizzle/0141_project_workflow_legacy_presentation_backfill.sql` | 42 | `b0647ac5d556` |
| `drizzle/0142_project_workflow_columns_realtime.sql` | 20 | `0c4f5ed0330c` |
| `drizzle/0143_project_guidance_invitations.sql` | 141 | `5d8ef2acdc91` |
| `drizzle/0144_project_social_links.sql` | 10 | `3f47cd6c6c84` |
| `drizzle/0145_project_sprint_events.sql` | 15 | `c930ec2872ab` |
| `drizzle/0146_sprint_activity_history.sql` | 14 | `688dae76d94b` |
| `drizzle/0147_foreign_key_leading_indexes.sql` | 22 | `c3ebaec6f1b3` |
| `drizzle/0148_sprint_timeline_origin.sql` | 15 | `96ce0df544ce` |
| `drizzle/0149_sprint_lifecycle_memberships.sql` | 84 | `0d1e9d462991` |
| `drizzle/0150_task_file_tags.sql` | 1 | `8439f5fa3a20` |
| `drizzle/0151_retire_project_custom_workflow.sql` | 25 | `b7c9fe0698fb` |
| `drizzle/0153_task_server_table_lineage.sql` | 45 | `db55f92506ee` |
| `drizzle/0154_native_database_security_hardening.sql` | 173 | `10612178fd0c` |
| `drizzle/0155_account_deletion_privacy.sql` | 29 | `6be7a1496b0b` |
| `drizzle/0156_profile_counter_authority.sql` | 15 | `5674be7cb458` |
| `drizzle/0157_storage_realtime_contract_alignment.sql` | 219 | `fbc4aaf5ea34` |
| `drizzle/0158_lifecycle_retention_indexes.sql` | 12 | `0fc0ad0ffba4` |
| `drizzle/0159_presence_project_members_authorization.sql` | 24 | `dbf8101f756a` |
| `drizzle/0160_realtime_authorization_activation.sql` | 83 | `ba02bf66b9d2` |
| `drizzle/0161_reviewed_github_sync.sql` | 69 | `f8dfbdfe333b` |
| `drizzle/0162_legal_acceptances.sql` | 34 | `9c9217f65474` |
| `drizzle/0163_system_scale_and_index_hardening.sql` | 35 | `36dcf8556007` |
| `drizzle/0164_extension_indexes_and_redis_locks.sql` | 37 | `9061436be7cb` |
| `drizzle/0165_messages_performance_and_deadlock_elimination.sql` | 83 | `067a95768778` |
| `drizzle/0166_project_recent_activity.sql` | 9 | `5237e48b903c` |
| `drizzle/0168_realtime_publication_trim.sql` | 6 | `c734c495c949` |
| `drizzle/0169_index_fixes.sql` | 19 | `61751dd9f5ae` |
| `drizzle/0170_rls_security.sql` | 14 | `ace47eabb688` |
| `drizzle/0171_sql_naming.sql` | 239 | `b5274cc732d0` |
| `drizzle/0173_node_events_single_table.sql` | 73 | `763b26f484db` |
| `drizzle/0174_drop_unused.sql` | 53 | `6e5635039e33` |
| `drizzle/0175_docs_retired_objects.sql` | 63 | `d55d3420675c` |
| `drizzle/0176_docs_any_slug_removable.sql` | 4 | `6e5991f16877` |

## Direct storage API discovery

This list is deliberately broader than runtime callers and includes import/type/test references. Indirect consumers are indexed separately in inventory.json.

- `scripts/backfill-file-hashes.ts`: 69
- `scripts/migrate-task-files-to-project-files.ts`: 69, 73, 81, 162, 165, 303
- `src/app/actions/account.ts`: 895
- `src/app/actions/files/content.ts`: 99, 154, 156
- `src/app/actions/files/versions.ts`: 159, 161, 437, 514
- `src/app/actions/messaging/index.ts`: 1001, 1003, 3173, 3222, 3305
- `src/app/actions/profile.ts`: 171, 227
- `src/app/actions/project/index.ts`: 390, 432, 506, 520, 3076, 3078, 6096, 6182, 6200
- `src/app/actions/project/updates.ts`: 1224, 1226
- `src/app/actions/upload.ts`: 83, 85, 190, 192
- `src/app/api/v1/extension/bulk-finalize/route.ts`: 158
- `src/app/api/v1/extension/bulk-intent/route.ts`: 91, 93
- `src/app/api/v1/extension/file/route.ts`: 111, 113, 165, 167, 176, 314, 351
- `src/app/api/v1/extension/file-upload/route.ts`: 140, 142, 168, 170, 298
- `src/app/api/v1/extension/recovery-drafts/route.ts`: 148, 150, 193, 208, 287
- `src/app/api/v1/github/import/abort/route.ts`: 90
- `src/app/api/v1/github/import/batch-file-intent/route.ts`: 118, 120
- `src/app/api/v1/github/import/file-intent/route.ts`: 79, 81
- `src/app/api/v1/github/import/finalize-file/route.ts`: 90
- `src/app/api/v1/github/import/finalize-manifest/route.ts`: 71
- `src/app/api/v1/github/import/init/route.ts`: 55, 57
- `src/app/api/v1/messages/attachments/[attachmentId]/route.ts`: 39, 41
- `src/app/api/v1/messages/attachments/presign/route.ts`: 115, 117, 234, 236
- `src/app/api/v1/projects/[id]/files/[nodeId]/preview/route.ts`: 77, 79
- `src/app/api/v1/projects/[id]/image/route.ts`: 83, 85
- `src/app/api/v1/projects/[id]/update-media/route.ts`: 57, 59
- `src/components/projects/updates/ProjectUpdateRichTextEditor.tsx`: 155, 209
- `src/components/projects/v2/explorer/useExplorerMutations.ts`: 746, 748
- `src/hooks/useFileVersions.ts`: 158, 160, 199
- `src/hooks/useTaskFileMutations.ts`: 98, 100, 132
- `src/inngest/functions/account-cleanup.ts`: 23, 40, 163
- `src/inngest/functions/cleanup-update.ts`: 37
- `src/inngest/functions/message-attachment-retention.ts`: 74
- `src/inngest/functions/profile-image-cleanup.ts`: 14
- `src/inngest/functions/project-files-key-migration.ts`: 77, 84, 134, 147
- `src/inngest/functions/project-import-hydrate.ts`: 74
- `src/lib/extension/recovery-drafts.ts`: 22
- `src/lib/files/apply-file-revision.ts`: 248
- `src/lib/files/permanent-delete.ts`: 175
- `src/lib/github/sync-service.ts`: 136, 417, 643, 800, 910
- `src/lib/upload/supabase-signed-upload-client.ts`: 18, 20
- `src/lib/upload/upload-intents.ts`: 231, 245, 370
- `src/lib/utils/cache-manager.ts`: 83, 89, 90, 103, 104, 132, 134
