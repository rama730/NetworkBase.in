# SQL review — every migration file, every table, and the cleanup plan

2026-10-30. Read-only review: no migration, app code or live data was changed. Replaces `sql-review-2026-10-29.md`. Covers all 272 files from 0000 to 0274, all checked against live today.

**Contents:** 1 Summary · 2 What changed since the last review · 3 Current status · 4 Problems found on live · 5 Checked and clean · 6 Approaches considered · 7 The new files · 8 Every table · 9 How to do it · 10 Risks and limits · Appendix A: all 272 files.

> **Update, 2026-10-30, after the cleanup was built:** the files are in the repo as 22 (the old-name views stay for now in `0022_project_compat_views`). Built from empty, they match live through 0276 with 0 real differences. Two changes from the plan below: the catalog file is a copy of live's rows, because the generator's full output differs from live, and `scripts/data/skill-catalog-released-lines.txt` keeps future catalog releases identical. Live's migration list was switched on 2026-10-30, with 0 schema changes; the old rows are in `app_private.app_migration_journal_pre_consolidation` until it is dropped after a week. New migrations start at 0023.
>
> **New security finding, S2 (High):** `anon` and `authenticated` can read every column of `public.profiles`, including `email` and `notification_preferences`, for all public profiles. `0199_browser_roles_read_only` (2026-10-07) restored a table-wide grant that `0079`/`0080` had removed. **Fixed on live 2026-10-30:** browsers now read only `id, username, full_name, avatar_url, visibility, created_at, updated_at, deleted_at`. Recorded in `0002_profiles_accounts`, guarded by `scripts/check-rls-contract.ts` and `tests/db/profile-browser-columns.test.ts`. Still open: `notification_preferences` on `workspaces` and `workspace_members` is browser-readable.

## 1. Summary

| | Today | After the cleanup | After the fixes |
|---|---:|---:|---:|
| SQL files in `drizzle/` | **272** | **21** | **27** |
| Lines of SQL | 70,215 | about 29,000 (live schema + full skill catalog) | + a few hundred |
| Can build a database from zero, by itself | no (needs a separate baseline file, which is out of date) | yes | yes |
| Duplicate numbers · generator names · unused numbers | 11 · 12 · 15 | 0 · 0 · 0 | 0 · 0 · 0 |

**What happens to the 272 files**

| Action | Files | Meaning |
|---|---:|---|
| **Merge** | 184 | Something they made is still on live. It moves into one of the 21 new files (Appendix A says which). |
| **Remove** | 88 | Nothing they made is left, or it's covered elsewhere: |
| | 38 | · everything it made was dropped |
| | 15 | · older skill-catalog release (rows are written in full in the new seed file) |
| | 12 | · only drops things |
| | 12 | · replaced by a later file |
| | 6 | · no effect left |
| | 5 | · one-time data fix, already applied |

**The order stays yours:** file cleanup first, fixes after. The cleanup changes nothing on live except the bookkeeping table that lists applied migrations. Live's tables, data, rules and permissions don't change.

**Why it's one switch and not 272 small edits:** live remembers every applied file by name and exact content (`app_migration_journal`, checked by `scripts/setup-database.ts`). So new files, the new journal in the repo and new journal rows on live change together, after proof that the new files build exactly what live has.

**You can keep adding SQL.** These numbers will change as you work, and that's fine. The method doesn't depend on them: the new files are written from whatever live is on the day. The first thing "implement" does is re-run this analysis. Migrations only need to pause while the cleanup itself runs.

## 2. What changed since the last review (0264–0274)

| File | What it did | Effect on this plan |
|---|---|---|
| `0264_workspace_rename` (2,706 lines) | Renamed 29 tables, 52 columns, 193 indexes, 180 constraints, 66 policies, and rewrote 44 functions from project to workspace. Added **29 views under the old names**, to last one release. | New file names and table map. Most of the old table names now exist only as views. Decision needed: §9 Step 0. |
| `0265`, `0266`, `0267` | Stored values say workspace, board column words, fixed the connection acceptance time. | Already part of live; go into 0006, 0008, 0015. |
| `0268_app_runtime_role` | New role **`nb_app`**, which production now connects as. An allow-all policy for it on all 125 tables, default permissions, safe functions for reading auth and storage tables, and an **event trigger** that adds the policy to every new table. | **New things to carry:** the role, the default permissions, the event trigger. A plain table dump misses all three. The event trigger must be created last (§7 rule 5). |
| `0269`, `0271`, `0272` | Trust & safety: 6 moderation tables, write guards on 8 tables, the live console with its realtime rules. | New content for `0018_moderation`. |
| `0270` | Session device names. | Goes into 0002. |
| `0273`, `0274` | Blocking: `user_blocks`, `user_mutes`, one `blocked_between` rule, 19 guard triggers on 17 tables. **Moved all blocks out of `connections`.** | New file `0019_blocking`. **Closes the old S1 security bug** (§4). |

**Corrections to my earlier reviews**
- Files that already run nowhere are **193**, not 196 (79 of the 272 still run on a fresh build).
- The old S1 bug is no longer a security problem.
- Earlier file statuses treated objects renamed by a computed rename as dropped. The tracer now follows renames, so some files moved from "remove" to "merge".
- Earlier reviews only looked for slow queries on the file tables. Looking at all queries turned up **P3**, the largest database load by far.

## 3. Current status (checked 2026-10-30)

| Item | State |
|---|---|
| Files | 272 files, numbered 0000–0274. 11 numbers are used by 2–3 files (0003, 0004, 0005, 0006, 0019, 0020, 0021, 0022, 0023, 0053, 0125). 15 numbers never used (0010–0012, 0045–0050, 0093, 0096, 0097, 0152, 0167, 0172). |
| Applied on live | **All 272** (latest: `0274_blocking_second_pass`, today 12:30 UTC). Every checksum matches the repo. |
| Extra rows on live | 7 old journal rows (`0073_notification_snooze` … `0079_job_heartbeats`, no index), declared as `legacyDatabaseTags` in `standards/sql-governance.manifest.json`. 279 rows in total. |
| Repo vs live | **Identical.** A throwaway Postgres 17 built from the repo, compared with a `pg_dump` of live: 0 differences in tables, columns, indexes, constraints, functions, triggers, policies and views. Also identical: 1,745 table grants, 167 function grants, 8 storage/realtime policies, 8 buckets, 12 realtime tables, the `auth.users` trigger, the `nb_app` role, its default permissions and event trigger. |
| **Gap: reference rows** | The throwaway DB has **52** catalog skills; live has **1,170**. Same for aliases (68 vs 1,310), categories (1 vs 25), icons (13 vs 758) and reserved usernames (1 vs 14). The baseline file (2026-10-06) has no reference rows, and later catalog files hold only *changes*. Live is fine; fresh test databases are missing most of the catalog. The cleanup fixes this. |
| How fresh databases are built today | `scripts/db/baseline/schema.sql` (through 0195) + 79 newer files. **The other 193 files already run nowhere.** |
| Live size | 125 tables (+96 chat partitions), 30 views, 660 indexes, 272 policies (139 feature rules, 125 `nb_app`, 8 storage/realtime), 117 functions, 65 triggers, 8 enum types. Data is small: 16 profiles, 15 workspaces, 30,562 file nodes. |
| History in the files | 67 tables, 25 functions and 210 policies were created and later removed. `0171` and `0264` renamed hundreds of objects, so reading old files doesn't tell you what live looks like. |
| File status | still used 178 · cleanup only 12 · dropped later 39 · grants/rls only 8 · does nothing 6 · one-time data fix 5 · seed data 4 · replaced later 20 |

## 4. Problems found on live

Ranked by risk. Each fix is its own new file after the cleanup, tested on a throwaway database, applied to live only with your OK.

| ID | Risk | Problem | Fix |
|---|---|---|---|
| **P3** new | **High at scale** | **Supabase Realtime's change polling is 44.4 of the 53.1 hours of query time recorded on this database (84%)**, with only 16 profiles. 27 million polling calls. 12 tables are published. Each write to them gets checked against every listener, so this cost grows with users and writes together. | No SQL yet. Measure which subscriptions matter, then move hot ones from `postgres_changes` to broadcast and drop those tables from the publication. This is a design task of its own and the most important finding for 1M users. |
| **P1** | High at scale | The storage backup job reads **all of `storage_assets` on every run**. Full scans went from 3,889 to 6,352 since the last review (yesterday). `EXPLAIN` confirms Seq Scan + Sort. Its query doesn't match `storage_assets_backup_due_idx`, which has 0 uses. The backup bucket isn't set up, so 9,808 of 9,830 assets stay "pending" and the job goes over them again and again. The old file-table scans **have stopped** (33,283 → 33,291 since the last review). | `0023_storage_backup_due_index`: an index that matches the job. Plus a code change: the job does nothing while no bucket is configured. |
| **D1** | Medium, data | 9 status/role columns are plain text with no rule, so a typo gets saved: `workspace_members.role` (owner 15, admin 6, member 3), `workspaces.visibility`, `workspaces.sync_status`, `tasks.review_status`, `workspace_update_drafts.visibility`, `profile_skills.visibility`, `user_notifications.kind`, `upload_intents.kind`, `workspace_nodes.type`. Live data is clean today. | `0024_status_role_checks`: `CHECK (col IN (…)) NOT VALID`, then `VALIDATE`. Allowed values come from the app code. |
| **P2** | Medium, write cost | **30 indexes are redundant** (each is the first part of a longer index on the same table). `workspace_nodes_deleted_at_partial_idx` and `tasks_deleted_at_partial_idx` only ever store NULL. Every insert and update pays for all of them. | `0025_drop_redundant_indexes`: `DROP INDEX CONCURRENTLY` for all 32, listed in `NON_TRANSACTIONAL_MIGRATIONS`. The 189 "never used" indexes stay until there's real traffic. |
| **P4** new | Low now | `user_mutes.muted_id` (from 0274) is a foreign key with no index, so deleting an account scans the whole table. It's the only such key on live. | `0026_user_mutes_muted_index`. |
| **C1** was S1 | Low, tidy-up | **The security bug is closed:** `0273` moved blocks to `user_blocks` (server only), `connections` has 0 blocked rows, and no code writes one. What's left: the old `connections_select_own` policy overlapping the newer one, a bare `auth.uid()` called per row, and the unused `blocked` status with `blocked_by`/`blocked_at` columns, which code in `src/lib/privacy/resolver.ts` still reads. | `0022_connections_policy_cleanup`: drop the old policy, wrap `auth.uid()`. Removing the columns is a separate code change. |
| **B1** new | To check | `subscribeUserNotifications` (`src/lib/realtime/subscriptions.ts`) listens for changes on `connections`, but `connections` isn't in the realtime publication (`0168` trimmed the list). Those two listeners can never fire. The feature may already work another way. | Check in the app, then either remove the listeners or add the table back. No file yet. |
| **L1** | Low | `workspaces_description_search_idx` is 4.6 MB for 15 rows. | One `REINDEX INDEX CONCURRENTLY` command, not a file. |
| **L2** | Low | `anon` can `SELECT` `user_notifications` and `connections`. Policies return nothing to anon, but no public page needs them. | `0027_revoke_unused_anon_grants`. |

The 30 redundant indexes: `comment_mentions_comment_idx`, `connection_suggestions_user_score_idx`, `connections_addressee_idx`, `connections_requester_idx`, `connections_status_idx`, `onboarding_events_user_id_idx`, `onboarding_submissions_user_id_idx`, `profile_audit_events_user_id_idx`, `skill_aliases_search_idx`, `task_comment_likes_comment_id_idx`, `task_comments_parent_id_idx`, `task_comments_task_id_idx`, `task_node_links_task_id_idx`, `task_pushes_task_idx`, `task_subtasks_task_id_idx`, `tasks_assignee_idx`, `tasks_workspace_idx`, `workspace_documents_workspace_idx`, `workspace_follows_workspace_id_idx`, `workspace_members_user_idx`, `workspace_members_workspace_idx`, `workspace_node_locks_locked_by_idx`, `workspace_node_locks_workspace_id_idx`, `workspace_nodes_workspace_id_idx`, `workspace_open_roles_workspace_idx`, `workspace_sprints_workspace_idx`, `workspace_update_likes_update_idx`, `workspaces_created_at_idx`, `workspaces_owner_idx`, `workspaces_status_idx`.

## 5. Checked and clean

- Every table has RLS on and a primary key.
- 51 tables have no rule except `nb_app`, which means no browser access. That's on purpose.
- **`nb_app_all` allowing every row is by design** (`0268`): authorization stays in the app, and the role can't change structure. It's safer than before, when production ran as `postgres`, which bypasses RLS. Worth knowing: this means RLS doesn't protect server queries, and `nb_app` can also write `app_migration_journal`.
- No duplicate indexes or triggers, no repeated permissive policies for the same role and action.
- Every `SECURITY DEFINER` function has a fixed `search_path`, and none can be called by `anon`.
- No browser write policy is open to everyone.
- Foreign keys have supporting indexes, except P4. 7 two-column keys rely on an index on their second column, which is enough. No key to `profiles`/`workspaces` blocks deletes (414 cascade, 106 set null, 9 restrict, 2 no action overall).
- No `int4` serial keys (no overflow risk). All 8 enum types are used.
- The block guards use indexed lookups (`user_blocks` has an index in each direction), so they stay cheap as data grows.
- `SELECT name FROM pg_timezone_names` (554 ms, 4,963 calls) comes from `authenticator` (Supabase's API layer), and no file in `src` or `scripts` calls it, so there's nothing to fix in the app.

**Worth watching, not a bug:** `chat_bootstrap` averages 280–397 ms with very little data, and it runs when messages open. Measure it again with more data.

## 6. Approaches considered

| Approach | Result | Verdict |
|---|---|---|
| A. Rename each file and delete the dead ones | about 180 files. Still can't build from zero. Still shows old names like `project_nodes`, which `0264` renamed. Needs the same journal switch. | Same risk, little gain |
| B. One file from live | 1 file, about 29,000 lines. Safe, but nothing is findable. | Too coarse |
| **C. 21 files by area, written from live, proven by diff** | Each file named after the part of the app it holds, using today's names. Builds from zero. | **Chosen** |

**No new SQL logic is written.** Postgres prints exactly what live has, and that output is sorted into the files. Appendix A is the record of where each old file's content went. What proves it's correct is one check: **a database built from the new files must equal live, with zero differences.** If it doesn't, nothing is switched.

## 7. The new files

| New file | Holds | Tables | Indexes | Policies | Old files feeding it |
|---|---|---:|---:|---:|---:|
| `0001_foundation.sql` | schemas, extensions, 8 enum types, the `nb_app` role and its default permissions, shared helpers, migration journal, job tables | 4 | 6 | 4 | 16 |
| `0002_profiles_accounts.sql` | profiles, usernames (+ reserved names), account security, deletion, legal acceptance, the `auth.users` trigger, the auth helper functions | 8 | 41 | 23 | 48 |
| `0003_storage.sql` | storage assets, quotas, repair queues, buckets and `storage.objects` rules | 6 | 29 | 6 | 8 |
| `0004_onboarding.sql` | onboarding drafts, events, submissions, the daily stats view | 3 | 13 | 8 | 11 |
| `0005_skills.sql` | skill catalog tables, aliases, icons, proposals, profile skills | 6 | 26 | 13 | 2 |
| `0006_workspaces_members.sql` | workspaces (organizations are workspaces too), members, open roles and units, applications, invitations, mentors, follows, tags, access helpers | 13 | 90 | 33 | 60 |
| `0007_organizations.sql` | org invites, handle holds, join blocks | 3 | 12 | 3 | 3 |
| `0008_tasks_sprints.sql` | tasks, subtasks, comments, sprints, board columns, task events | 14 | 83 | 37 | 43 |
| `0009_files.sql` | file tree (`workspace_nodes`), versions, locks, conflicts, file index, upload intents | 9 | 78 | 29 | 44 |
| `0010_documents.sql` | workspace documents, versions, opens, sprint materials | 4 | 20 | 12 | 14 |
| `0011_github_imports.sql` | GitHub sync and import jobs | 7 | 22 | 7 | 8 |
| `0012_workspace_updates.sql` | workspace updates, comments, likes, drafts, media | 6 | 35 | 16 | 19 |
| `0013_contributions.sql` | profile contributions (portfolio), stages, drafts, media, skills, collaboration summaries | 6 | 31 | 12 | 13 |
| `0014_messaging.sql` | chat channels, members, messages (32 partitions each for messages, reactions, attachments), pins, reports, all chat functions | 14 | 49 | 28 | 23 |
| `0015_connections.sql` | connections, suggestions, dismissals | 3 | 22 | 7 | 24 |
| `0016_notifications_email.sql` | in-app notifications, deliveries, push, email outbox, suppressions, webhooks | 6 | 31 | 9 | 11 |
| `0017_browser_extension.sql` | extension device sessions, recovery sessions and drafts | 4 | 21 | 8 | 11 |
| `0018_moderation.sql` | reports, cases, actions, appeals, the event log, templates, blocked identities, staff functions, the console's realtime rules, write guards | 7 | 47 | 7 | 8 |
| `0019_blocking.sql` | `user_blocks`, `user_mutes`, the `blocked_between` rule, the block guards (19 triggers on 17 tables) | 2 | 4 | 2 | 2 |
| `0020_skill_catalog_1_3_7.sql` | the market skill catalog rows, release 1.3.7, written in full (reference data only, no user data) | 0 | 0 | 0 | 1 |
| `0021_new_table_rule.sql` | the event trigger that gives every new table its `nb_app` policy. It must come last (rule 5) | 0 | 0 | 0 | 1 |

An old file that touched several areas feeds several new files, so the last column adds up to more than 184. Policy counts include one `nb_app_all` per table.

**Rules for writing them**
1. Files run 0001 → 0021, each building on the earlier ones.
2. **Anything that links two areas goes in the later of the two files.** That's 2 foreign keys (`profiles → storage_assets` in 0003, `workspace_node_locks → extension_device_sessions` in 0017) and **39 triggers**: 19 block guards in 0019, 8 moderation guards in 0018, 6 notification-cleanup triggers in 0016, 5 chat triggers in 0014, and `seed_workspace_workflow_columns` in 0008. Checked: no policy calls a helper from a later file.
3. Each file starts with `SET LOCAL check_function_bodies = off` (as `pg_dump` does), so a helper can mention a table created later in the same run.
4. Statements are separated by `--> statement-breakpoint`, and indexes use plain `CREATE INDEX`: the files only ever run on empty databases, and live marks them applied without running them.
5. **The `nb_app` role and default permissions come first (0001), and its event trigger comes last (0021).** The new files state each table's `nb_app_all` policy explicitly. If the event trigger already existed, it would add the policy first and the explicit line would fail with "already exists". On live it keeps doing its job.
6. Pieces outside `public`/`app_private` are written out on purpose: the `auth.users` trigger `nb_sync_email_verified_claim` (0002), the 14 `reserved_usernames` rows (0002), the 8 buckets and 8 `storage.objects`/`realtime.messages` policies (the file of the feature they serve), and the realtime publication (each table's own file).
7. **`0020_skill_catalog_1_3_7`** holds the full catalog. It's the generator's own statement list for 1.3.7 (`scripts/generate-skill-catalog.ts`) without the "only changes" filter, so the next release keeps working unchanged. User-proposed skills are user data and are not in it. Row-by-row comparison with live proves it. **If you release a new catalog version before the cleanup, this file takes that version's number.**
8. `nb_app` is created `NOLOGIN`, as in `0268`. Its password stays outside the repo (`docs/ops/runtime-database-role.md`). Live isn't affected.

## 8. Every table

All 125 live tables, grouped by new file.
- **Browser**: what signed-in users can do through the Supabase API. "server only" means no grant, so only the server touches the table.
- **Idx**: total indexes (never used since 2025-12-08 / redundant).
- **Hist**: how many migration files changed the table.
- **Issues**: codes from §4.

### 0001_foundation

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `app_migration_journal` | 279 | 160 kB | 8 | 2 (0 / 0) | 1 | server only |  | — | legacy | 0 |  |
| `counter_flush_batches` | 21 | 48 kB | 4 | 2 (0 / 0) | 1 | server only |  | — | 0214 | 1 |  |
| `job_heartbeats` | 8 | 64 kB | 4 | 1 (0 / 0) | 1 | server only |  | — | 0072 | 1 |  |
| `work_leases` | 0 | 16 kB | 6 | 1 (0 / 0) | 1 | server only |  | — | 0213 | 1 |  |

### 0002_profiles_accounts

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `account_deletions` | 0 | 40 kB | 14 | 4 (0 / 0) | 2 | server only |  | — | 0074 | 4 |  |
| `legal_acceptances` | 4 | 80 kB | 9 | 4 (0 / 0) | 1 | server only |  | — | 0162 | 2 |  |
| `profile_audit_events` | 23668 | 14 MB | 7 | 7 (0 / 1) | 2 | server only |  | profiles | 0020 | 6 | **P2** ×1 |
| `profile_security_states` | 13 | 48 kB | 6 | 2 (1 / 0) | 5 | server only |  | profiles | 0061 | 2 |  |
| `profiles` | 16 | 696 kB | 52 | 16 (6 / 0) | 4 | read + anon | yes | storage_assets | 0000 | 33 |  |
| `recovery_code_redemptions` | 0 | 32 kB | 4 | 3 (1 / 0) | 3 | server only |  | profiles | 0062 | 1 |  |
| `reserved_usernames` | 14 | 32 kB | 3 | 1 (0 / 0) | 1 | server only |  | — | 0020 | 2 |  |
| `username_aliases` | 47 | 80 kB | 5 | 4 (0 / 0) | 5 | server only |  | profiles | 0056 | 3 |  |

### 0003_storage

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `storage_asset_operations` | 22 | 80 kB | 14 | 4 (1 / 0) | 1 | server only |  | profiles, storage_assets | 0178 | 1 |  |
| `storage_asset_pins` | 0 | 40 kB | 6 | 4 (0 / 0) | 1 | server only |  | storage_assets | 0178 | 1 |  |
| `storage_assets` | 9830 | 17 MB | 30 | 11 (1 / 0) | 1 | server only |  | — | 0178 | 2 | **P1** |
| `storage_legacy_cleanup_targets` | 0 | 40 kB | 16 | 4 (0 / 0) | 1 | server only |  | — | 0178 | 2 |  |
| `storage_quota_scopes` | 8 | 80 kB | 8 | 2 (1 / 0) | 1 | server only |  | — | 0178 | 1 |  |
| `storage_repair_failures` | 2358 | 1872 kB | 10 | 4 (1 / 0) | 1 | server only |  | — | 0178 | 1 |  |

### 0004_onboarding

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `onboarding_drafts` | 0 | 96 kB | 9 | 3 (2 / 0) | 2 | server only |  | profiles | 0020 | 6 |  |
| `onboarding_events` | 1 | 440 kB | 6 | 5 (0 / 1) | 2 | server only |  | profiles | 0020 | 4 | **P2** ×1 |
| `onboarding_submissions` | 7 | 96 kB | 9 | 5 (3 / 1) | 4 | server only |  | profiles | 0020 | 7 | **P2** ×1 |

### 0005_skills

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `profile_skills` | 8 | 112 kB | 11 | 4 (0 / 0) | 2 | server only |  | profiles, skills | 0023 | 3 | **D1** visibility |
| `skill_aliases` | 1312 | 1280 kB | 8 | 4 (1 / 1) | 2 | server only |  | skills | 0103 | 1 | **P2** ×1 |
| `skill_categories` | 25 | 96 kB | 9 | 3 (0 / 0) | 2 | server only |  | — | 0103 | 1 |  |
| `skill_icon_assets` | 758 | 624 kB | 15 | 1 (0 / 0) | 2 | server only |  | — | 0103 | 10 |  |
| `skill_proposals` | 15 | 96 kB | 11 | 5 (3 / 0) | 3 | server only |  | profiles, skills | 0103 | 2 |  |
| `skills` | 1180 | 1784 kB | 19 | 9 (3 / 0) | 2 | server only |  | skill_categories | 0023 | 13 |  |

### 0006_workspaces_members

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `application_events` | 7 | 80 kB | 10 | 4 (1 / 0) | 2 | server only |  | profiles, role_applications | 0129 | 2 |  |
| `role_applications` | 5 | 208 kB | 15 | 12 (5 / 0) | 2 | server only |  | profiles, workspace_open_roles, workspaces | 0006 | 27 |  |
| `role_skills` | 1 | 80 kB | 8 | 4 (0 / 0) | 2 | server only |  | skills, workspace_open_roles | 0103 | 2 |  |
| `tags` | 17 | 88 kB | 4 | 4 (0 / 0) | 2 | server only |  | — | 0023 | 2 |  |
| `workspace_event_counters` | 15 | 56 kB | 3 | 1 (0 / 0) | 1 | server only |  | workspaces | 0178 | 2 |  |
| `workspace_follows` | 5 | 104 kB | 4 | 4 (1 / 1) | 5 | read + anon |  | profiles, workspaces | 0003 | 6 | **P2** ×1 |
| `workspace_invitations` | 1 | 168 kB | 18 | 10 (4 / 0) | 2 | server only |  | profiles, workspace_open_roles, workspaces | 0143 | 10 |  |
| `workspace_members` | 24 | 168 kB | 11 | 8 (1 / 2) | 2 | read + anon |  | profiles, workspace_open_roles, workspaces | 0000 | 12 | **D1** role · **P2** ×2 |
| `workspace_mentors` | 0 | 64 kB | 15 | 7 (3 / 0) | 2 | server only |  | profiles, workspace_invitations, workspaces | 0143 | 5 |  |
| `workspace_open_roles` | 10 | 72 kB | 14 | 4 (1 / 1) | 5 | server only |  | profiles, workspaces | 0003 | 8 | **P2** ×1 |
| `workspace_skills` | 16 | 96 kB | 8 | 4 (0 / 0) | 2 | server only |  | skills, workspaces | 0023 | 6 |  |
| `workspace_tags` | 29 | 56 kB | 4 | 3 (1 / 0) | 2 | server only |  | tags, workspaces | 0023 | 5 |  |
| `workspaces` | 15 | 5432 kB | 70 | 25 (6 / 3) | 4 | server only | yes | profiles, storage_assets | 0000 | 40 | **D1** visibility, sync_status · **P2** ×3 · **L1** |

### 0007_organizations

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `org_email_invites` | 0 | 64 kB | 11 | 7 (5 / 0) | 1 | server only |  | profiles, workspace_open_roles, workspaces | 0241 | 3 |  |
| `org_handle_holds` | 0 | 24 kB | 4 | 2 (1 / 0) | 1 | server only |  | workspaces | 0241 | 1 |  |
| `org_join_blocks` | 0 | 24 kB | 4 | 3 (2 / 0) | 1 | server only |  | profiles, workspaces | 0241 | 2 |  |

### 0008_tasks_sprints

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `comment_mentions` | 0 | 32 kB | 4 | 4 (1 / 1) | 3 | server only |  | profiles, task_comments | 0070 | 3 | **P2** ×1 |
| `sprint_task_memberships` | 2 | 120 kB | 8 | 7 (5 / 0) | 1 | server only |  | profiles, tasks, workspace_sprints, workspaces | 0149 | 3 |  |
| `task_activity_events` | 74 | 152 kB | 8 | 6 (3 / 0) | 1 | server only |  | profiles, tasks, workspace_sprints, workspaces | 0137 | 5 |  |
| `task_comment_likes` | 1 | 72 kB | 4 | 4 (1 / 1) | 5 | read + anon | yes | profiles, task_comments | 0008 | 8 | **P2** ×1 |
| `task_comments` | 4 | 144 kB | 9 | 8 (4 / 2) | 5 | read + anon | yes | profiles, tasks | 0008 | 14 | **P2** ×2 |
| `task_pushes` | 1 | 96 kB | 8 | 5 (3 / 1) | 1 | server only |  | profiles, tasks, workspaces | 0153 | 3 | **P2** ×1 |
| `task_read_receipts` | 3 | 40 kB | 3 | 2 (0 / 0) | 1 | server only |  | profiles, tasks | 0153 | 1 |  |
| `task_subtasks` | 4 | 72 kB | 8 | 4 (1 / 1) | 5 | read + anon | yes | profiles, tasks | 0006 | 8 | **P2** ×1 |
| `task_team_members` | 0 | 16 kB | 4 | 2 (1 / 0) | 1 | server only |  | profiles, tasks | 0244 | 1 |  |
| `tasks` | 23 | 416 kB | 32 | 21 (10 / 2) | 5 | read + anon | yes | profiles, workspace_sprints, workspace_workflow_columns, workspaces | 0003 | 22 | **D1** review_status · **P2** ×2 · **P2** NULL-only index |
| `workspace_sprint_events` | 2 | 80 kB | 7 | 4 (2 / 0) | 1 | server only |  | profiles, workspace_sprints, workspaces | 0145 | 2 |  |
| `workspace_sprints` | 1 | 152 kB | 20 | 9 (2 / 1) | 5 | server only |  | profiles, workspaces | 0003 | 10 | **P2** ×1 |
| `workspace_task_policy_events` | 2 | 56 kB | 6 | 3 (1 / 0) | 1 | server only |  | profiles, workspaces | 0233 | 2 |  |
| `workspace_workflow_columns` | 60 | 144 kB | 11 | 4 (0 / 0) | 2 | read + anon | yes | workspaces | 0139 | 5 |  |

### 0009_files

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `file_versions` | 9798 | 9792 kB | 12 | 7 (1 / 0) | 3 | server only |  | profiles, storage_assets, workspace_nodes | 0068 | 8 |  |
| `task_node_links` | 6 | 112 kB | 8 | 6 (0 / 1) | 5 | read + anon | yes | profiles, tasks, workspace_nodes | 0004 | 13 | **P2** ×1 |
| `upload_intents` | 58 | 248 kB | 19 | 7 (1 / 0) | 2 | server only |  | profiles, storage_assets, workspaces | 0062 | 5 | **D1** kind |
| `workspace_file_index` | 6 | 232 kB | 4 | 3 (1 / 0) | 5 | server only |  | workspace_nodes, workspaces | 0004 | 7 |  |
| `workspace_git_deltas` | 0 | 56 kB | 19 | 6 (1 / 0) | 1 | server only |  | file_versions, tasks, workspace_nodes, workspaces | 0086 | 3 |  |
| `workspace_node_conflicts` | 0 | 40 kB | 10 | 4 (1 / 0) | 1 | server only |  | tasks, workspace_nodes, workspaces | 0086 | 3 |  |
| `workspace_node_events` | 9964 | 8176 kB | 8 | 7 (0 / 0) | 5 | server only |  | profiles, workspace_nodes, workspaces | 0004 | 16 |  |
| `workspace_node_locks` | 0 | 216 kB | 11 | 10 (3 / 2) | 2 | read + anon | yes | extension_device_sessions, profiles, workspace_nodes, workspaces | 0004 | 9 | **P2** ×2 |
| `workspace_nodes` | 30562 | 57 MB | 22 | 28 (2 / 1) | 5 | server only |  | profiles, storage_assets, tasks, workspaces | 0003 | 27 | **D1** type · **P2** ×1 · **P2** NULL-only index |

### 0010_documents

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `doc_opens` | 0 | 16 kB | 4 | 2 (1 / 0) | 1 | server only |  | profiles, workspace_documents | 0246 | 1 |  |
| `sprint_materials` | 0 | 56 kB | 6 | 7 (3 / 0) | 1 | server only |  | profiles, workspace_documents, workspace_nodes, workspace_sprints | 0243 | 2 |  |
| `workspace_document_versions` | 17 | 632 kB | 14 | 5 (1 / 0) | 5 | server only |  | profiles, workspace_documents, workspaces | 0072 | 8 |  |
| `workspace_documents` | 9 | 216 kB | 9 | 6 (0 / 1) | 5 | server only |  | workspace_document_versions, workspace_nodes, workspaces | 0072 | 12 | **P2** ×1 |

### 0011_github_imports

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `github_contributor_identities` | 2 | 48 kB | 7 | 2 (0 / 0) | 1 | server only |  | profiles | 0161 | 2 |  |
| `github_sync_connections` | 1 | 32 kB | 8 | 1 (0 / 0) | 1 | server only |  | workspaces | 0161 | 3 |  |
| `github_sync_files` | 2261 | 2256 kB | 10 | 4 (1 / 0) | 1 | server only |  | workspace_nodes, workspaces | 0161 | 4 |  |
| `github_sync_runs` | 7 | 944 kB | 13 | 5 (1 / 0) | 1 | server only |  | profiles, workspaces | 0161 | 4 |  |
| `github_sync_snapshot_assets` | 0 | 64 kB | 4 | 3 (0 / 0) | 1 | server only |  | github_sync_runs, storage_assets | 0178 | 1 |  |
| `import_job_files` | 0 | 32 kB | 11 | 3 (0 / 0) | 1 | server only |  | import_jobs, upload_intents | 0086 | 2 |  |
| `import_jobs` | 0 | 40 kB | 12 | 4 (2 / 0) | 1 | server only |  | storage_assets, upload_intents, workspaces | 0086 | 4 |  |

### 0012_workspace_updates

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `workspace_update_comments` | 5 | 176 kB | 11 | 10 (6 / 0) | 4 | read + anon | yes | profiles, workspace_updates, workspaces | 0063 | 12 |  |
| `workspace_update_draft_media_assets` | 0 | 24 kB | 5 | 3 (0 / 0) | 1 | server only |  | storage_assets, workspace_update_drafts | 0178 | 2 |  |
| `workspace_update_drafts` | 2 | 96 kB | 8 | 3 (2 / 0) | 2 | server only |  | profiles, workspaces | 0082 | 4 | **D1** visibility |
| `workspace_update_likes` | 7 | 72 kB | 4 | 4 (2 / 1) | 4 | server only |  | profiles, workspace_updates | 0063 | 3 | **P2** ×1 |
| `workspace_update_media_assets` | 1 | 72 kB | 5 | 4 (0 / 0) | 1 | server only |  | storage_assets, workspace_updates | 0178 | 2 |  |
| `workspace_updates` | 10 | 184 kB | 22 | 11 (5 / 0) | 4 | read + anon | yes | profiles, workspaces | 0063 | 13 |  |

### 0013_contributions

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `profile_collaboration_summaries` | 10 | 264 kB | 9 | 3 (2 / 0) | 2 | server only |  | profiles | 0076 | 3 |  |
| `profile_contribution_drafts` | 4 | 80 kB | 4 | 2 (1 / 0) | 2 | server only |  | profile_contributions, profiles | 0237 | 1 |  |
| `profile_contribution_media_assets` | 1 | 40 kB | 2 | 2 (0 / 0) | 2 | server only |  | profile_contributions, storage_assets | 0237 | 1 |  |
| `profile_contribution_skills` | 36 | 128 kB | 9 | 5 (1 / 0) | 2 | server only |  | profile_contributions, profiles, skills | 0103 | 4 |  |
| `profile_contribution_stages` | 23 | 176 kB | 20 | 10 (5 / 0) | 2 | server only |  | profile_contributions, profiles, workspaces | 0077 | 9 |  |
| `profile_contributions` | 24 | 208 kB | 26 | 9 (3 / 0) | 2 | server only |  | profiles, workspaces | 0076 | 11 |  |

### 0014_messaging

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `chat_attachments` (+32 partitions) | 3 | 816 kB | 10 | 2 (0 / 0) | 2 | server only |  | chat_messages, storage_assets | 0180 | 2 |  |
| `chat_canvases` | 1 | 72 kB | 7 | 3 (2 / 0) | 2 | server only |  | chat_channels, profiles | 0182 | 3 |  |
| `chat_channel_members` | 32 | 48 kB | 9 | 2 (0 / 0) | 2 | server only |  | chat_channels, profiles | 0180 | 2 |  |
| `chat_channel_tabs` | 1 | 88 kB | 8 | 5 (1 / 0) | 2 | server only |  | chat_channels, profiles | 0187 | 4 |  |
| `chat_channels` | 20 | 144 kB | 19 | 8 (1 / 0) | 2 | server only |  | profiles, role_applications, workspaces | 0180 | 4 |  |
| `chat_mentions` | 1 | 80 kB | 6 | 4 (1 / 0) | 2 | server only |  | chat_messages, profiles | 0180 | 5 |  |
| `chat_message_cards` | 3 | 48 kB | 5 | 2 (0 / 0) | 2 | server only |  | chat_messages | 0180 | 2 |  |
| `chat_messages` (+32 partitions) | 51 | 2048 kB | 14 | 5 (0 / 0) | 2 | server only |  | chat_channels, profiles | 0180 | 8 |  |
| `chat_pins` | 0 | 32 kB | 4 | 2 (1 / 0) | 2 | server only |  | chat_messages, profiles | 0180 | 3 |  |
| `chat_reactions` (+32 partitions) | 11 | 888 kB | 5 | 2 (0 / 0) | 2 | server only |  | chat_messages, profiles | 0180 | 3 |  |
| `chat_reports` | 0 | 40 kB | 7 | 4 (2 / 0) | 2 | server only |  | chat_messages, profiles | 0180 | 2 |  |
| `chat_saved` | 0 | 56 kB | 7 | 4 (1 / 0) | 2 | server only |  | chat_messages, profiles | 0187 | 3 |  |
| `chat_scheduled_messages` | 0 | 40 kB | 10 | 4 (0 / 0) | 2 | server only |  | chat_channels, profiles | 0187 | 3 |  |
| `chat_thread_follows` | 2 | 40 kB | 5 | 2 (0 / 0) | 2 | server only |  | chat_messages, profiles | 0180 | 1 |  |

### 0015_connections

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `connection_suggestion_dismissals` | 0 | 64 kB | 4 | 4 (1 / 0) | 2 | server only |  | profiles | 0020 | 4 |  |
| `connection_suggestions` | 0 | 48 kB | 8 | 5 (1 / 1) | 2 | server only |  | profiles | 0058 | 4 | **P2** ×1 |
| `connections` | 5 | 208 kB | 12 | 13 (12 / 3) | 3 | read + anon |  | profiles | 0000 | 18 | **P2** ×3 · **C1** · **B1** · **L2** |

### 0016_notifications_email

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `email_outbox` | 16 | 192 kB | 21 | 6 (1 / 0) | 1 | server only |  | profiles | 0205 | 7 |  |
| `email_suppressions` | 0 | 16 kB | 3 | 1 (0 / 0) | 1 | server only |  | — | 0205 | 1 |  |
| `email_webhook_events` | 4 | 48 kB | 5 | 2 (0 / 0) | 1 | server only |  | — | 0205 | 1 |  |
| `notification_deliveries` | 36 | 104 kB | 9 | 5 (2 / 0) | 2 | server only |  | profiles, user_notifications | 0072 | 4 |  |
| `push_subscriptions` | 0 | 40 kB | 10 | 4 (2 / 0) | 2 | server only |  | profiles | 0072 | 2 |  |
| `user_notifications` | 63 | 344 kB | 19 | 13 (1 / 0) | 2 | read + anon | yes | profiles | 0072 | 3 | **D1** kind · **L2** |

### 0017_browser_extension

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `extension_device_session_events` | 102 | 112 kB | 7 | 3 (0 / 0) | 1 | server only |  | extension_device_sessions | 0086 | 4 |  |
| `extension_device_sessions` | 34 | 120 kB | 19 | 4 (0 / 0) | 1 | server only |  | profiles | 0086 | 3 |  |
| `extension_recovery_drafts` | 0 | 192 kB | 22 | 9 (4 / 0) | 5 | server only |  | profiles, storage_assets, workspace_nodes, workspaces | 0100 | 4 |  |
| `extension_recovery_sessions` | 44 | 136 kB | 12 | 5 (0 / 0) | 1 | server only |  | profiles | 0102 | 2 |  |

### 0018_moderation

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `content_reports` | 1 | 144 kB | 16 | 9 (4 / 0) | 1 | server only |  | moderation_cases, profiles, workspaces | 0254 | 7 |  |
| `moderation_actions` | 0 | 80 kB | 26 | 9 (4 / 0) | 1 | server only |  | moderation_cases, profiles, workspaces | 0269 | 1 |  |
| `moderation_appeals` | 0 | 56 kB | 12 | 6 (2 / 0) | 1 | server only |  | moderation_cases, profiles | 0269 | 1 |  |
| `moderation_blocked_identities` | 0 | 24 kB | 4 | 2 (1 / 0) | 1 | server only |  | moderation_actions | 0269 | 1 |  |
| `moderation_cases` | 1 | 184 kB | 33 | 13 (7 / 0) | 1 | server only |  | profiles, workspaces | 0269 | 2 |  |
| `moderation_events` | 75 | 112 kB | 7 | 6 (1 / 0) | 1 | server only |  | moderation_cases, profiles | 0269 | 2 |  |
| `moderation_message_templates` | 0 | 24 kB | 4 | 2 (1 / 0) | 1 | server only |  | profiles | 0272 | 1 |  |

### 0019_blocking

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `user_blocks` | 1 | 56 kB | 7 | 3 (1 / 0) | 1 | server only |  | moderation_cases, profiles | 0273 | 1 |  |
| `user_mutes` | 0 | 8192 bytes | 3 | 1 (0 / 0) | 1 | server only |  | profiles | 0274 | 1 | **P4** |

**Tables that existed once and are gone (67).** None come back:

`posts`, `conversation_participants`, `conversations`, `message_attachments`, `messages`, `saved_projects`, `task_files`, `typing_indicators`, `dm_pairs`, `attachment_uploads`, `message_edit_logs`, `message_hidden_for_users`, `project_run_diagnostics`, `project_run_logs`, `project_run_profiles`, `project_run_sessions`, `collection_projects`, `collections`, `interests`, `profile_interests`, `message_reactions`, `tasks_p0`, `tasks_p1`, `tasks_p2`, `tasks_p3`, `tasks_p4`, `tasks_p5`, `tasks_p6`, `tasks_p7`, `tasks_p8`, `tasks_p9`, `tasks_p10`, `tasks_p11`, `tasks_p12`, `tasks_p13`, `tasks_p14`, `tasks_p15`, `tasks_partitioned`, `messages_p0`, `messages_p1`, `messages_p2`, `messages_p3`, `messages_p4`, `messages_p5`, `messages_p6`, `messages_p7`, `messages_p8`, `messages_p9`, `messages_p10`, `messages_p11`, `messages_p12`, `messages_p13`, `messages_p14`, `messages_p15`, `messages_partitioned`, `profile_counters`, `message_reports`, `message_read_receipts`, `message_workflow_items`, `message_work_links`, `message_delivery_receipts`, `project_doc_assets`, `skill_relationships`, `skill_catalog_releases`, `skill_popularity_snapshots`, `app_private.retired_domain_archive`, `message_pins`

**Views (30):** `onboarding_slo_daily` stays (0004). The other 29 are the old project names from `0264`, such as `projects` and `project_members`: see Step 0.

## 9. How to do it

### Step 0 — before starting
1. **Re-run this analysis.** You're adding SQL quickly, so it starts from whatever exists that day.
2. **Pause new migrations** while the cleanup runs, only from Step 1 to Step 4. Everything else can continue.
3. **Decide about the 29 old-name views.** The plan from the rename was to drop them after one release. A search of the code finds these names only in comments. **Recommended:** drop them first in one normal migration (`0275_drop_project_compat_views`), once you confirm the deployed code and the VS Code extension no longer read them. If you'd rather wait, they go into a temporary `0022_project_compat_views`, and everything after shifts by one.
4. Commit anything in `drizzle/` that's unfinished. All 272 files are live and committed today.

### Step 1 — write the 21 files (repo only)
A one-off script takes a fresh read-only `pg_dump` of live and puts every object into its area file, using the table map in §8 and the rules in §7. It runs from a scratch folder and isn't added to the repo. Each file opens with a short note saying what it holds.

### Step 2 — prove it (throwaway database only)
| Check | Must be |
|---|---|
| Empty Postgres 17 + `scripts/db/supabase-shim.sql` + the 21 files | runs with no errors |
| `pg_dump` of `public` + `app_private` vs live | **0 differences** |
| Grants, storage/realtime policies, buckets, realtime list, `auth.users` trigger, `nb_app` role, default permissions, event trigger, view options vs live | identical (same query used in this review) |
| Catalog and reserved-username rows vs live, compared row by row | identical |
| `npm run check:db:remigration-replay`, `check:db-catalog-drift`, `check:rls-contract`, `check:sql-governance`, `check:db:migration-journal`, `check:db:runtime-role` | pass |
| Unit and db test suites | pass |

If any check fails, fix the script and run Step 2 again. Live is never touched in this step. **The ordering rules in §7 are checked by analysis so far; this is the step that actually proves them.**

### Step 3 — update everything that names old files (repo only)
| What | Change |
|---|---|
| `drizzle/meta/_journal.json` | 21 entries |
| `standards/sql-governance.manifest.json` | `existingMigrationFiles` = the 21 paths, `legacyDatabaseTags` emptied, `strictLineageFromIndex` = 0 |
| `scripts/setup-database.ts` `NON_TRANSACTIONAL_MIGRATIONS` | Its 9 old names are removed. |
| 35 test and script files that read 63 specific old files | Each one points at the new file that now holds what it checks. Tests that only guard a past step are deleted. Done file by file, not by search-and-replace. |
| `scripts/db/baseline/schema.sql`, `scripts/db/adopt-baseline.ts`, `scripts/db/dump-baseline.ts` | Deleted: the files now build from zero. `scripts/db/disposable-db.sh` drops its baseline lines. |
| The 272 old files | Deleted from the folder. Git keeps them; the commit before the switch is tagged `sql-pre-consolidation`. |

One local commit on main. Nothing pushed.

**⏸ Stop: I show you the files, the proof and the test results. Nothing happens on live until you say yes.**

### Step 4 — switch live (one transaction, bookkeeping table only, as `postgres`)
```sql
BEGIN;
CREATE TABLE app_private.app_migration_journal_pre_consolidation AS TABLE public.app_migration_journal;  -- backup: 279 rows
DELETE FROM public.app_migration_journal;
INSERT INTO public.app_migration_journal (tag, journal_index, checksum, status, started_at, completed_at) VALUES
  ('0001_foundation', 0, '<sha256 of file>', 'completed', now(), now()),
  …
  ('0021_new_table_rule', 20, '<sha256 of file>', 'completed', now(), now());
COMMIT;
```
- No table, column, index, policy, permission or row of app data changes. The app keeps running and users notice nothing. Production's `nb_app` doesn't use this table for anything at runtime.
- Afterwards, `npm run check:db:migration-sources` (dry run) and `check:db:live-lineage` must report 21 applied, 0 pending, 0 differences.
- **Undo:** `DELETE FROM public.app_migration_journal; INSERT INTO public.app_migration_journal SELECT * FROM app_private.app_migration_journal_pre_consolidation;`, then check out the tag `sql-pre-consolidation`. Drop the backup table after a week.
- Pushing to GitHub and deploying only happen when you ask.

### Step 5 — the fixes, one at a time, each with your OK
| File | Fixes |
|---|---|
| `0022_connections_policy_cleanup` | C1 |
| `0023_storage_backup_due_index` | P1, plus the job code change |
| `0024_status_role_checks` | D1 |
| `0025_drop_redundant_indexes` | P2 |
| `0026_user_mutes_muted_index` | P4 |
| `0027_revoke_unused_anon_grants` | L2 |
| one command | L1 |

**Total: 27 files.** P3 (Realtime load) and B1 are separate work, after measuring and checking.

### From then on
One change, one file, a name that says what it does (`0028_add_org_invite_expiry`), never edited after it's applied.

## 10. Risks and limits

| Risk | How it's handled |
|---|---|
| Something on live isn't captured | Step 2 compares schema, grants, storage/realtime policies, buckets, realtime list, `auth.users` trigger, role, default permissions, event trigger and reference rows. |
| A migration arrives mid-way | The pause. A file that slips in after Step 1 means Step 1 runs again, or it's kept as the next numbered file. It isn't lost. |
| The ordering rules fail on a real build | Step 2 finds it on a throwaway database, and the script gets fixed. |
| A test quietly stops checking something | The 35 files are updated one by one, by name, in the same commit. |
| A deploy applies old files | Deploys don't run migrations. `db:setup` is run by hand. |
| "Never used" index stats are thin | Only redundant and NULL-only indexes are dropped. |

**Limits of this review**
- The 21 files haven't been built yet, so "zero differences" is what Step 2 has to prove.
- Appendix A is a record, not what makes this safe. Some objects were renamed by computed names in `0171` that can't be read from the file. An object with no explicit drop on a table that still exists is counted as surviving, so a few merge/remove labels could be off. That doesn't change the result, because the new files come from live.
- Query stats go back to 2025-12-08, cover old and new code together, and the data is small. Real load will show more.
- Things Supabase changes on its side aren't covered.

---

## Appendix A — all 272 files

**Status** says what's left of the file on live today. **Action** is merge or remove. For a merge, the last column is the new file(s) its content goes to; for a remove, it's why.

| # | Old file | Lines | Status | Action | Goes to / why |
|---:|---|---:|---|---|---|
| 1 | `0000_medical_the_liberteens` | 76 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0015_connections` |
| 2 | `0001_remarkable_mattie_franklin` | 17 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0015_connections` |
| 3 | `0002_spotty_paladin` | 1 | cleanup only | **remove** | only drops things |
| 4 | `0003_ambitious_skin` ⚠ dup no. | 165 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files` |
| 5 | `0004_harsh_randall` ⚠ dup no. | 75 | still used | merge | `0009_files` |
| 6 | `0005_spooky_romulus` ⚠ dup no. | 5 | still used | merge | `0008_tasks_sprints` |
| 7 | `0006_furry_susan_delgado` ⚠ dup no. | 51 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files` |
| 8 | `0007_typing_indicators` | 75 | dropped later | **remove** | everything it made was dropped |
| 9 | `0008_task_features` | 224 | still used | merge | `0008_tasks_sprints` |
| 10 | `0009_fix_rls_policies` | 137 | dropped later | **remove** | everything it made was dropped |
| 11 | `0013_task_node_links` | 19 | still used | merge | `0009_files` |
| 12 | `0014_project_file_index` | 42 | still used | merge | `0009_files` |
| 13 | `0015_project_node_locks` | 50 | still used | merge | `0009_files` |
| 14 | `0016_project_nodes_trash_and_events` | 72 | still used | merge | `0009_files` |
| 15 | `0017_drop_task_files` | 6 | cleanup only | **remove** | only drops things |
| 16 | `0018_role_applications_message_and_constraints` | 40 | still used | merge | `0006_workspaces_members` |
| 17 | `0019_messaging_rls_and_realtime` ⚠ dup no. | 142 | dropped later | **remove** | everything it made was dropped |
| 18 | `0020_dm_pairs` ⚠ dup no. | 23 | dropped later | **remove** | everything it made was dropped |
| 19 | `0021_add_project_conversation_id` ⚠ dup no. | 11 | still used | merge | `0006_workspaces_members` |
| 20 | `0019_demonic_bloodscream` ⚠ dup no. | 2 | still used | merge | `0006_workspaces_members` |
| 21 | `0020_damp_shatterstar` ⚠ dup no. | 231 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_workspaces_members`, `0009_files`, `0015_connections` |
| 22 | `0021_faithful_warstar` ⚠ dup no. | 17 | dropped later | **remove** | everything it made was dropped |
| 23 | `0022_handy_tombstone` ⚠ dup no. | 35 | still used | merge | `0008_tasks_sprints`, `0009_files` |
| 24 | `0023_little_quasimodo` ⚠ dup no. | 106 | still used | merge | `0002_profiles_accounts`, `0005_skills`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files` |
| 25 | `0003_messaging` ⚠ dup no. | 282 | dropped later | **remove** | everything it made was dropped |
| 26 | `0004_chat_storage` ⚠ dup no. | 78 | dropped later | **remove** | everything it made was dropped |
| 27 | `0004_message_reactions` ⚠ dup no. | 126 | dropped later | **remove** | everything it made was dropped |
| 28 | `0005_enable_connections_realtime` ⚠ dup no. | 3 | grants/rls only | merge | `0015_connections` |
| 29 | `0006_messages_performance_indexes` ⚠ dup no. | 95 | dropped later | **remove** | everything it made was dropped |
| 30 | `0022_messaging_reliability_and_scale` ⚠ dup no. | 132 | dropped later | **remove** | everything it made was dropped |
| 31 | `0023_message_attachments_storage_path` ⚠ dup no. | 24 | dropped later | **remove** | everything it made was dropped |
| 32 | `0024_attachment_upload_sessions` | 33 | dropped later | **remove** | everything it made was dropped |
| 33 | `0025_message_actions_edit_delete` | 37 | dropped later | **remove** | everything it made was dropped |
| 34 | `0026_project_members_unique` | 22 | still used | merge | `0006_workspaces_members` |
| 35 | `0027_task_node_links_unique` | 24 | still used | merge | `0009_files` |
| 36 | `0028_project_follow_counts` | 46 | still used | merge | `0006_workspaces_members` |
| 37 | `0029_workspace_layout` | 7 | still used | merge | `0002_profiles_accounts` |
| 38 | `0030_message_reply_and_preview` | 33 | dropped later | **remove** | everything it made was dropped |
| 39 | `0031_connection_suggestion_dismissals` | 33 | still used | merge | `0015_connections` |
| 40 | `0032_project_runner_sessions` | 176 | dropped later | **remove** | everything it made was dropped |
| 41 | `0033_onboarding_username_guardrails` | 74 | still used | merge | `0002_profiles_accounts` |
| 42 | `0034_onboarding_reliability_and_telemetry` | 120 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 43 | `0035_onboarding_submission_integrity` | 281 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0012_workspace_updates` |
| 44 | `0036_onboarding_claims_repair_queue` | 6 | still used | merge | `0004_onboarding` |
| 45 | `0037_onboarding_submissions_updated_at_trigger` | 30 | dropped later | **remove** | everything it made was dropped |
| 46 | `0038_profile_audit_events` | 19 | still used | merge | `0002_profiles_accounts` |
| 47 | `0039_files_workspace_scale_indexes` | 53 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 48 | `0040_projects_github_columns` | 30 | still used | merge | `0006_workspaces_members`, `0009_files` |
| 49 | `0041_username_rules_schema_qualification` | 24 | still used | merge | `0002_profiles_accounts` |
| 50 | `0042_schema_hardening_constraints_and_fks` | 205 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 51 | `0043_project_files_key_policy_dual_read` | 102 | dropped later | **remove** | everything it made was dropped |
| 52 | `0044_onboarding_profile_extended_preferences` | 71 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 53 | `0051_clever_scarecrow` | 138 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 54 | `0052_workspace_profile_counters` | 72 | still used | merge | `0002_profiles_accounts`, `0008_tasks_sprints` |
| 55 | `0053_security_recovery_codes` ⚠ dup no. | 4 | dropped later | **remove** | everything it made was dropped |
| 56 | `0054_privacy_system_foundation` | 60 | still used | merge | `0002_profiles_accounts`, `0015_connections` |
| 57 | `0053_database_partitioning` ⚠ dup no. | 107 | dropped later | **remove** | everything it made was dropped |
| 58 | `0055_workspace_profile_counters_table` | 53 | dropped later | **remove** | everything it made was dropped |
| 59 | `0056_username_aliases_and_exact_lookup_cleanup` | 43 | still used | merge | `0002_profiles_accounts` |
| 60 | `0057_username_index_dedup_cleanup` | 5 | cleanup only | **remove** | only drops things |
| 61 | `0058_connection_suggestions` | 37 | still used | merge | `0015_connections` |
| 62 | `0059_messaging_reactions_reports_receipts` | 154 | dropped later | **remove** | everything it made was dropped |
| 63 | `0060_messaging_collaboration_foundation` | 504 | dropped later | **remove** | everything it made was dropped |
| 64 | `0061_profile_security_state_privacy_rls` | 100 | still used | merge | `0002_profiles_accounts`, `0003_storage` |
| 65 | `0062_upload_intents_and_recovery_redemptions` | 102 | still used | merge | `0002_profiles_accounts`, `0009_files` |
| 66 | `0063_database_setup_authority_backfill` | 756 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_workspaces_members`, `0009_files`, `0012_workspace_updates`, `0015_connections` |
| 67 | `0064_messaging_reactions_reports_receipts_rls` | 137 | dropped later | **remove** | everything it made was dropped |
| 68 | `0065_profile_security_recovery_factor_binding` | 25 | still used | merge | `0002_profiles_accounts` |
| 69 | `0066_message_delivery_receipts` | 126 | dropped later | **remove** | everything it made was dropped |
| 70 | `0067_read_receipts_conversation_id` | 87 | dropped later | **remove** | everything it made was dropped |
| 71 | `0068_file_versions` | 142 | still used | merge | `0009_files` |
| 72 | `0069_project_nodes_current_version` | 44 | still used | merge | `0009_files` |
| 73 | `0070_comment_mentions` | 106 | still used | merge | `0008_tasks_sprints` |
| 74 | `0071_realtime_publication_extension` | 26 | does nothing | **remove** | no effect left |
| 75 | `0072_user_notifications` | 568 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0010_documents`, `0015_connections`, `0016_notifications_email` |
| 76 | `0073_message_reactions_conversation_scope` | 31 | dropped later | **remove** | everything it made was dropped |
| 77 | `0074_v2_schema_optimizations` | 252 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections`, `0016_notifications_email` |
| 78 | `0075_review_optimization_indexes` | 81 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 79 | `0076_profile_collaboration_projection` | 187 | still used | merge | `0013_contributions` |
| 80 | `0077_profile_collaboration_role_stages` | 132 | still used | merge | `0013_contributions` |
| 81 | `0078_public_rls_security_hardening` | 899 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0005_skills`, `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0010_documents`, `0015_connections`, `0016_notifications_email` |
| 82 | `0079_profile_column_privilege_hardening` | 44 | grants/rls only | merge | its grants are written into the owning table's new file |
| 83 | `0080_profile_write_privilege_hardening` | 41 | grants/rls only | merge | its grants are written into the owning table's new file |
| 84 | `0081_project_updates_realtime` | 43 | does nothing | **remove** | no effect left |
| 85 | `0082_project_update_drafts` | 33 | still used | merge | `0012_workspace_updates` |
| 86 | `0083_project_update_drafts_rls` | 54 | dropped later | **remove** | everything it made was dropped |
| 87 | `0084_team_invite_collaboration_status` | 6 | still used | merge | `0006_workspaces_members` |
| 88 | `0085_project_update_media_storage` | 104 | one-time data fix | **remove** | one-time data fix, already applied |
| 89 | `0086_virtual_workspace_fields` | 165 | still used | merge | `0006_workspaces_members`, `0009_files`, `0011_github_imports`, `0017_browser_extension` |
| 90 | `0087_non_transactional_indexes` | 37 | dropped later | **remove** | everything it made was dropped |
| 91 | `0088_extension_device_session_editor_metadata` | 9 | still used | merge | `0017_browser_extension` |
| 92 | `0089_project_node_event_sequence_trigger` | 42 | still used | merge | `0009_files` |
| 93 | `0090_project_update_comment_threads` | 42 | still used | merge | `0012_workspace_updates` |
| 94 | `0091_extension_auth_code_events` | 25 | still used | merge | `0017_browser_extension` |
| 95 | `0092_project_updates_performance_indexes` | 18 | still used | merge | `0012_workspace_updates` |
| 96 | `0094_lovely_toad` | 14 | still used | merge | `0012_workspace_updates` |
| 97 | `0095_docs_hub_upgrade` | 141 | still used | merge | `0001_foundation`, `0010_documents` |
| 98 | `0098_onboarding_state_machine` | 75 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 99 | `0099_schema_lineage_and_fk_indexes` | 132 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0010_documents`, `0011_github_imports`, `0012_workspace_updates`, `0013_contributions`, `0015_connections`, `0017_browser_extension` |
| 100 | `0100_extension_recovery_drafts` | 80 | still used | merge | `0017_browser_extension` |
| 101 | `0101_project_file_leases` | 97 | still used | merge | `0009_files` |
| 102 | `0102_extension_recovery_sessions` | 32 | still used | merge | `0017_browser_extension` |
| 103 | `0103_market_skill_catalog` | 266 | still used | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 104 | `0104_market_skill_seed` | 1884 | seed data | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 105 | `0105_market_skill_catalog_1_0_1` | 1895 | seed data | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 106 | `0106_role_skill_visibility_hardening` | 26 | dropped later | **remove** | everything it made was dropped |
| 107 | `0107_market_skill_catalog_1_1_0` | 3414 | seed data | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 108 | `0108_market_skill_icons_1_2_0` | 3485 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 109 | `0109_skill_catalog_fk_indexes` | 16 | still used | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 110 | `0110_market_skill_icons_1_2_1` | 3520 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 111 | `0111_market_skill_catalog_1_3_0` | 3867 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 112 | `0112_market_skill_catalog_1_3_1` | 3867 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 113 | `0113_market_skill_catalog_1_3_2` | 3903 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 114 | `0114_market_skill_catalog_1_3_3` | 4285 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 115 | `0115_market_skill_catalog_1_3_4` | 4285 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 116 | `0116_market_skill_catalog_1_3_5` | 4284 | replaced later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 117 | `0117_market_skill_catalog_1_3_6` | 4354 | still used | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 118 | `0118_remove_profile_availability_status` | 23 | dropped later | **remove** | everything it made was dropped |
| 119 | `0119_open_roles_ecosystem` | 59 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members` |
| 120 | `0120_ponytail_message_system_cleanup` | 43 | cleanup only | **remove** | only drops things |
| 121 | `0121_ponytail_skill_catalog_table_cleanup` | 24 | dropped later | **remove** | older catalog release; rows written in full in `0020_skill_catalog_1_3_7` |
| 122 | `0122_ponytail_database_hardening` | 972 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0006_workspaces_members`, `0009_files`, `0016_notifications_email` |
| 123 | `0123_ponytail_duplicate_index_completion` | 7 | cleanup only | **remove** | only drops things |
| 124 | `0124_ponytail_storage_bucket_contracts` | 33 | one-time data fix | **remove** | one-time data fix, already applied |
| 125 | `0125_ponytail_realtime_publication_trim` ⚠ dup no. | 27 | does nothing | **remove** | no effect left |
| 126 | `0126_extension_session_disconnect_callback` | 3 | still used | merge | `0017_browser_extension` |
| 127 | `0127_profile_contribution_authority` | 269 | still used | merge | `0002_profiles_accounts`, `0013_contributions` |
| 128 | `0128_notification_activity_state_contract` | 26 | still used | merge | `0016_notifications_email` |
| 129 | `0129_messages_data_authority` | 1274 | still used | merge | `0001_foundation`, `0003_storage`, `0006_workspaces_members` |
| 130 | `0130_messages_fk_support_indexes` | 17 | dropped later | **remove** | everything it made was dropped |
| 131 | `0131_messages_native_payload_contract` | 49 | dropped later | **remove** | everything it made was dropped |
| 132 | `0132_message_notification_preview_redaction` | 6 | one-time data fix | **remove** | one-time data fix, already applied |
| 133 | `0133_message_preview_lifecycle` | 125 | dropped later | **remove** | everything it made was dropped |
| 134 | `0134_message_reaction_activity` | 50 | dropped later | **remove** | everything it made was dropped |
| 135 | `0135_project_custom_workflow` | 13 | dropped later | **remove** | everything it made was dropped |
| 136 | `0136_task_board_read_index` | 4 | still used | merge | `0008_tasks_sprints` |
| 137 | `0137_task_activity_events` | 15 | still used | merge | `0008_tasks_sprints` |
| 138 | `0138_task_activity_actor_index` | 3 | still used | merge | `0008_tasks_sprints` |
| 139 | `0139_project_workflow_columns` | 36 | still used | merge | `0008_tasks_sprints` |
| 140 | `0140_project_workflow_defaults_trigger` | 21 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints` |
| 141 | `0141_project_workflow_legacy_presentation_backfill` | 43 | does nothing | **remove** | no effect left |
| 142 | `0142_project_workflow_columns_realtime` | 21 | dropped later | **remove** | everything it made was dropped |
| 143 | `0143_project_guidance_invitations` | 142 | still used | merge | `0006_workspaces_members` |
| 144 | `0144_project_social_links` | 11 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members` |
| 145 | `0145_project_sprint_events` | 16 | still used | merge | `0008_tasks_sprints` |
| 146 | `0146_sprint_activity_history` | 15 | still used | merge | `0008_tasks_sprints` |
| 147 | `0147_foreign_key_leading_indexes` | 23 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints` |
| 148 | `0148_sprint_timeline_origin` | 16 | still used | merge | `0008_tasks_sprints` |
| 149 | `0149_sprint_lifecycle_memberships` | 85 | still used | merge | `0008_tasks_sprints` |
| 150 | `0150_task_file_tags` | 2 | still used | merge | `0009_files` |
| 151 | `0151_retire_project_custom_workflow` | 26 | replaced later | **remove** | replaced by a later file |
| 152 | `0125_ponytail_allow_office_mimes` ⚠ dup no. | 26 | one-time data fix | **remove** | one-time data fix, already applied |
| 153 | `0153_task_server_table_lineage` | 46 | still used | merge | `0008_tasks_sprints` |
| 154 | `0154_native_database_security_hardening` | 174 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0008_tasks_sprints`, `0013_contributions` |
| 155 | `0155_account_deletion_privacy` | 30 | cleanup only | **remove** | only drops things |
| 156 | `0156_profile_counter_authority` | 16 | cleanup only | **remove** | only drops things |
| 157 | `0157_storage_realtime_contract_alignment` | 220 | replaced later | **remove** | replaced by a later file |
| 158 | `0158_lifecycle_retention_indexes` | 13 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0017_browser_extension` |
| 159 | `0159_presence_project_members_authorization` | 25 | replaced later | **remove** | replaced by a later file |
| 160 | `0160_realtime_authorization_activation` | 84 | replaced later | **remove** | replaced by a later file |
| 161 | `0161_reviewed_github_sync` | 70 | still used | merge | `0009_files`, `0011_github_imports` |
| 162 | `0162_legal_acceptances` | 35 | still used | merge | `0002_profiles_accounts` |
| 163 | `0163_system_scale_and_index_hardening` | 36 | still used | merge | `0008_tasks_sprints`, `0009_files`, `0012_workspace_updates`, `0015_connections`, `0016_notifications_email` |
| 164 | `0164_extension_indexes_and_redis_locks` | 38 | still used | merge | `0009_files`, `0011_github_imports`, `0017_browser_extension` |
| 165 | `0165_messages_performance_and_deadlock_elimination` | 84 | still used | merge | `0001_foundation`, `0002_profiles_accounts` |
| 166 | `0166_project_recent_activity` | 10 | still used | merge | `0006_workspaces_members` |
| 167 | `0168_realtime_publication_trim` | 7 | grants/rls only | merge | `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 168 | `0169_index_fixes` | 20 | still used | merge | `0009_files`, `0011_github_imports` |
| 169 | `0170_rls_security` | 15 | still used | merge | `0002_profiles_accounts` |
| 170 | `0171_sql_naming` | 240 | still used | merge | `0001_foundation`, `0003_storage`, `0006_workspaces_members`, `0010_documents` |
| 171 | `0173_node_events_single_table` | 74 | still used | merge | `0009_files` |
| 172 | `0174_drop_unused` | 54 | cleanup only | **remove** | only drops things |
| 173 | `0175_docs_retired_objects` | 64 | still used | merge | `0010_documents` |
| 174 | `0176_docs_any_slug_removable` | 5 | cleanup only | **remove** | only drops things |
| 175 | `0177_projects_member_file_upload_default` | 4 | still used | merge | `0006_workspaces_members` |
| 176 | `0178_storage_asset_lifecycle` | 554 | still used | merge | `0002_profiles_accounts`, `0003_storage`, `0006_workspaces_members`, `0009_files`, `0011_github_imports`, `0012_workspace_updates`, `0017_browser_extension` |
| 177 | `0179_live_catalog_storage_release_hardening` | 226 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0011_github_imports`, `0013_contributions` |
| 178 | `0180_chat_rebuild_additive` | 1400 | still used | merge | `0001_foundation`, `0006_workspaces_members`, `0008_tasks_sprints`, `0014_messaging` |
| 179 | `0181_chat_rebuild_cutover` | 192 | replaced later | **remove** | replaced by a later file |
| 180 | `0182_chat_canvases` | 76 | still used | merge | `0014_messaging` |
| 181 | `0183_chat_typing_topic` | 68 | dropped later | **remove** | everything it made was dropped |
| 182 | `0184_presence_status` | 56 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members` |
| 183 | `0185_chat_rename_default_channel` | 41 | still used | merge | `0014_messaging` |
| 184 | `0186_status_emoji` | 47 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members` |
| 185 | `0187_chat_reorganize` | 325 | still used | merge | `0014_messaging` |
| 186 | `0188_chat_tab_files` | 6 | still used | merge | `0014_messaging` |
| 187 | `0189_chat_audit_fixes` | 145 | still used | merge | `0014_messaging` |
| 188 | `0190_chat_thread_self_reply` | 107 | replaced later | **remove** | replaced by a later file |
| 189 | `0191_chat_channel_privacy` | 51 | replaced later | **remove** | replaced by a later file |
| 190 | `0192_chat_inbox_mute_rule` | 18 | still used | merge | `0014_messaging` |
| 191 | `0193_chat_round3_counts` | 256 | still used | merge | `0014_messaging` |
| 192 | `0194_chat_link_preview_hidden` | 4 | still used | merge | `0014_messaging` |
| 193 | `0195_discover_feed_indexes` | 23 | still used | merge | `0006_workspaces_members` |
| 194 | `0196_rls_p0_visibility` | 103 | still used | merge | `0009_files`, `0010_documents`, `0015_connections` |
| 195 | `0197_chat_due_work_leases` | 7 | still used | merge | `0014_messaging` |
| 196 | `0198_account_deletion_phases` | 20 | still used | merge | `0002_profiles_accounts` |
| 197 | `0199_browser_roles_read_only` | 40 | grants/rls only | merge | its grants are written into the owning table's new file |
| 198 | `0200_project_tab_rls` | 130 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0009_files`, `0012_workspace_updates` |
| 199 | `0201_tenant_composite_fks` | 88 | still used | merge | `0008_tasks_sprints`, `0009_files`, `0010_documents`, `0012_workspace_updates` |
| 200 | `0202_chat_integrity` | 147 | still used | merge | `0014_messaging` |
| 201 | `0203_trigger_metadata_completeness` | 33 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members` |
| 202 | `0204_retired_objects_cleanup` | 46 | still used | merge | `0010_documents` |
| 203 | `0205_transactional_email_outbox` | 57 | still used | merge | `0016_notifications_email` |
| 204 | `0206_foreign_key_indexes` | 49 | still used | merge | `0006_workspaces_members`, `0012_workspace_updates`, `0013_contributions`, `0014_messaging`, `0016_notifications_email` |
| 205 | `0207_catalog_parity` | 11 | still used | merge | `0014_messaging` |
| 206 | `0208_native_auth_uid` | 27 | still used | merge | `0013_contributions` |
| 207 | `0209_skill_catalog_1_3_7` | 190 | seed data | merge | `0020_skill_catalog_1_3_7` |
| 208 | `0210_index_cleanup` | 28 | still used | merge | `0012_workspace_updates` |
| 209 | `0211_discover_index_hygiene` | 24 | cleanup only | **remove** | only drops things |
| 210 | `0212_onboarding_attempt_token` | 6 | still used | merge | `0004_onboarding` |
| 211 | `0213_work_leases` | 20 | still used | merge | `0001_foundation` |
| 212 | `0214_counter_flush_batches` | 19 | still used | merge | `0001_foundation` |
| 213 | `0215_projects_import_source_private` | 16 | grants/rls only | merge | its grants are written into the owning table's new file |
| 214 | `0216_task_position_backfill` | 29 | does nothing | **remove** | no effect left |
| 215 | `0217_project_update_single_pin` | 20 | dropped later | **remove** | everything it made was dropped |
| 216 | `0218_profile_collaboration_availability` | 28 | still used | merge | `0002_profiles_accounts` |
| 217 | `0219_connection_acceptance_time` | 25 | still used | merge | `0015_connections` |
| 218 | `0220_extension_operation_receipts_index` | 4 | still used | merge | `0009_files` |
| 219 | `0221_project_members_user_role_idx` | 5 | still used | merge | `0006_workspaces_members` |
| 220 | `0222_email_verified_claim` | 29 | still used | merge | `0002_profiles_accounts` |
| 221 | `0223_revoke_connection_acceptance_trigger_exec` | 4 | grants/rls only | merge | its grants are written into the owning table's new file |
| 222 | `0224_presence_activity_authority` | 83 | still used | merge | `0001_foundation` |
| 223 | `0225_deleted_projects_own_no_chat` | 104 | still used | merge | `0006_workspaces_members`, `0014_messaging` |
| 224 | `0226_application_thread_rules` | 318 | still used | merge | `0014_messaging` |
| 225 | `0227_application_lifecycle_constraints` | 41 | still used | merge | `0006_workspaces_members` |
| 226 | `0228_application_thread_messaging` | 229 | still used | merge | `0006_workspaces_members`, `0014_messaging` |
| 227 | `0229_drop_application_proposal_columns` | 16 | cleanup only | **remove** | only drops things |
| 228 | `0230_application_update_one_trip` | 40 | replaced later | **remove** | replaced by a later file |
| 229 | `0231_validate_application_message_length` | 14 | does nothing | **remove** | no effect left |
| 230 | `0232_application_thread_guards` | 254 | still used | merge | `0006_workspaces_members`, `0014_messaging` |
| 231 | `0233_task_completion_policy` | 32 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints` |
| 232 | `0234_application_closures` | 22 | still used | merge | `0006_workspaces_members` |
| 233 | `0235_onboarding_integrity` | 103 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 234 | `0236_storage_media_contracts` | 60 | one-time data fix | **remove** | one-time data fix, already applied |
| 235 | `0237_profile_contribution_stories` | 53 | still used | merge | `0002_profiles_accounts`, `0013_contributions` |
| 236 | `0238_application_acceptance_security_hardening` | 22 | still used | merge | `0006_workspaces_members` |
| 237 | `0239_connections_security_and_indexes` | 75 | still used | merge | `0015_connections` |
| 238 | `0240_member_welcome_card_and_channel_joins` | 154 | replaced later | **remove** | replaced by a later file |
| 239 | `0241_organizations_core` | 236 | still used | merge | `0006_workspaces_members`, `0007_organizations` |
| 240 | `0242_discover_updates_feed_index` | 8 | still used | merge | `0012_workspace_updates` |
| 241 | `0243_org_sprints` | 59 | still used | merge | `0008_tasks_sprints`, `0010_documents` |
| 242 | `0244_org_assignments` | 129 | still used | merge | `0008_tasks_sprints`, `0009_files` |
| 243 | `0245_org_updates` | 122 | still used | merge | `0012_workspace_updates` |
| 244 | `0246_org_docs` | 31 | still used | merge | `0010_documents` |
| 245 | `0247_org_files` | 95 | still used | merge | `0009_files` |
| 246 | `0248_org_profile` | 8 | still used | merge | `0013_contributions` |
| 247 | `0249_org_chat` | 384 | still used | merge | `0014_messaging` |
| 248 | `0250_org_email` | 17 | still used | merge | `0016_notifications_email` |
| 249 | `0251_org_foreign_key_indexes` | 21 | still used | merge | `0006_workspaces_members`, `0007_organizations`, `0010_documents` |
| 250 | `0252_role_applications_server_writes` | 9 | cleanup only | **remove** | only drops things |
| 251 | `0253_security_email_kinds` | 13 | replaced later | **remove** | replaced by a later file |
| 252 | `0254_org_trust_lifecycle` | 117 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0012_workspace_updates`, `0014_messaging`, `0018_moderation` |
| 253 | `0255_security_email_completed` | 12 | replaced later | **remove** | replaced by a later file |
| 254 | `0256_content_reports_reporter_index` | 4 | still used | merge | `0018_moderation` |
| 255 | `0257_unit_leads` | 5 | still used | merge | `0006_workspaces_members` |
| 256 | `0258_sprint_notify_on_start` | 3 | still used | merge | `0008_tasks_sprints` |
| 257 | `0259_subtask_completed_by` | 4 | still used | merge | `0008_tasks_sprints` |
| 258 | `0260_contribution_work_record` | 3 | still used | merge | `0013_contributions` |
| 259 | `0261_org_chat_defaults` | 105 | replaced later | **remove** | replaced by a later file |
| 260 | `0262_contribution_browser_grants` | 6 | grants/rls only | merge | its grants are written into the owning table's new file |
| 261 | `0263_org_type_other` | 6 | still used | merge | `0006_workspaces_members` |
| 262 | `0264_workspace_rename` | 2707 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0006_workspaces_members`, `0007_organizations`, `0008_tasks_sprints`, `0009_files`, `0010_documents`, `0011_github_imports`, `0012_workspace_updates`, `0013_contributions`, `0014_messaging`, `0016_notifications_email`, `0017_browser_extension`, `0018_moderation` |
| 263 | `0265_workspace_stored_values` | 103 | still used | merge | `0002_profiles_accounts`, `0006_workspaces_members`, `0010_documents`, `0013_contributions`, `0018_moderation` |
| 264 | `0266_workflow_column_words` | 29 | still used | merge | `0008_tasks_sprints` |
| 265 | `0267_connection_acceptance_time_fix` | 18 | still used | merge | `0015_connections` |
| 266 | `0268_app_runtime_role` | 181 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0009_files`, `0021_new_table_rule` |
| 267 | `0269_moderation_cases_appeals` | 322 | still used | merge | `0006_workspaces_members`, `0008_tasks_sprints`, `0012_workspace_updates`, `0014_messaging`, `0015_connections`, `0016_notifications_email`, `0018_moderation` |
| 268 | `0270_session_device_from_browser` | 20 | still used | merge | `0002_profiles_accounts` |
| 269 | `0271_moderation_events_account_deletion` | 15 | still used | merge | `0018_moderation` |
| 270 | `0272_trust_console_live` | 102 | still used | merge | `0018_moderation` |
| 271 | `0273_user_blocks` | 399 | still used | merge | `0001_foundation`, `0006_workspaces_members`, `0008_tasks_sprints`, `0012_workspace_updates`, `0014_messaging`, `0015_connections`, `0019_blocking` |
| 272 | `0274_blocking_second_pass` | 262 | still used | merge | `0001_foundation`, `0006_workspaces_members`, `0014_messaging`, `0018_moderation`, `0019_blocking` |
