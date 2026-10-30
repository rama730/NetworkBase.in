# SQL review — every migration file, every table, and the cleanup plan

2026-10-29. Read-only review: nothing in the repo or on live was changed. Everything below was checked against live today, after 0257–0263 were applied.

**Contents:** 1 Summary · 2 Current status · 3 Problems found on live · 4 What's checked and clean · 5 Approaches considered · 6 The new files · 7 Every table · 8 How to do it · 9 Risks · Appendix A: all 261 files.

## 1. Summary

| | Today | After the cleanup | After the fixes |
|---|---:|---:|---:|
| SQL files in `drizzle/` | **261** | **19** | **24** |
| Lines of SQL | 66,057 | about 25,000 (live schema + full skill catalog) | + a few hundred |
| Can build a database from zero, by itself | no (needs a separate baseline file, which is out of date) | yes | yes |
| Duplicate numbers · generator names · unused numbers | 11 · 12 · 15 | 0 · 0 · 0 | 0 · 0 · 0 |
| Open problems on live | 6 (§3) | 6 (cleanup changes nothing on live) | 0 |

**What happens to the 261 files**

| Action | Files | Meaning |
|---|---:|---|
| **Merge** | 176 | Something they made is still on live. It moves into one of the 19 new files (Appendix A says which). |
| **Remove** | 85 | Nothing they made is left, or what's left is covered elsewhere: |
| | 41 | · everything it made was dropped |
| | 12 | · only drops things |
| | 12 | · older skill-catalog release (rows are written in full in the new seed file) |
| | 9 | · replaced by a later file |
| | 6 | · no effect left |
| | 5 | · one-time data fix, already applied |

**Order of work (your order):** 1) file cleanup → 2) fixes. The cleanup changes nothing on live except the bookkeeping table that lists applied migrations. The fixes then come as 5 new, clearly named files.

**The one rule that makes it safe:** live remembers every applied file by name and exact content (`app_migration_journal`, checked by `scripts/setup-database.ts`). So renaming or deleting files can't be done one at a time. It's one switch: new files, new journal in the repo, and new journal rows on live, all together, after a proof that the new files build exactly what live has.

## 2. Current status (checked 2026-10-29)

| Item | State |
|---|---|
| Files | 261 files, numbered 0000–0263. 11 numbers are used by 2–3 files (0003, 0004, 0005, 0006, 0019, 0020, 0021, 0022, 0023, 0053, 0125). 15 numbers never used (0010–0012, 0045–0050, 0093, 0096, 0097, 0152, 0167, 0172). |
| Applied on live | **All 261** (0257–0263 applied today at 03:49 UTC). Every checksum matches the repo. |
| Extra rows on live | 7 old journal rows (`0073_notification_snooze` … `0079_job_heartbeats`, no index), already declared as `legacyDatabaseTags` in `standards/sql-governance.manifest.json`. |
| Repo vs live schema | **Identical.** A throwaway Postgres 17 built from the repo, compared with a `pg_dump` of live: 0 differences in tables, columns, indexes, constraints, functions, triggers and policies. Grants (854 table, 46 function), storage/realtime policies, 8 buckets, 12 realtime tables and the `auth.users` trigger also match. |
| **Gap found: reference rows** | The throwaway DB has **52** catalog skills; live has **1,170**. Same for aliases (68 vs 1,310), categories (1 vs 25), icons (13 vs 758) and reserved usernames (1 vs 14). The baseline file was made on 2026-10-06, before reference rows were added to it, and the catalog files after it hold only *changes*. Live is fine; fresh test databases are missing most of the catalog. The cleanup fixes this. |
| How fresh databases are built today | `scripts/db/baseline/schema.sql` (live as of 0195) + files 0196–0263. **Files 0000–0195 (196 files) already run nowhere.** |
| Live size | 117 tables (+96 chat partitions), 615 indexes, 139 policies, 84 functions, 30 triggers, 8 enum types. Data is small: 16 profiles, 15 projects, 30,562 file nodes. |
| History in the files | 67 tables, 27 functions and 220 policies were created and later removed. `0171_sql_naming` renamed ~250 objects with computed names, so most live names appear in no file. |
| File status | still used 168 · cleanup only 12 · dropped later 41 · grants/rls only 8 · replaced later 17 · does nothing 6 · one-time data fix 5 · seed data 4 |

## 3. Problems found on live

Ranked by risk. Each fix is its own new file after the cleanup, tested on a throwaway DB first, applied to live only with your OK.

| ID | Risk | Problem | Fix (new file) |
|---|---|---|---|
| **S1** | **High, security** | `0239` meant to hide the "blocked" row from the person who was blocked (`connections_select_participant_visible`). An older policy, **`connections_select_own`** (role `public`), still lets both people see every row. Permissive policies add together, so 0239's fix does nothing. Signed-in users can read `connections` through the API. The newer policy also calls `auth.uid()` bare, so once per row. | `0020_connections_block_visibility`: drop `connections_select_own`, wrap `auth.uid()` in `(select …)`. Test: blocked user sees 0 blocked rows, blocker sees 1. |
| **P1** | High at scale | The storage backup job reads **all of `storage_assets` on every run**: 3,867 runs, 106 ms each, 675 full scans since yesterday (`EXPLAIN` confirms a Seq Scan + Sort of all rows). Its query (`backup_state = $1 AND state IN ($2,$3) … ORDER BY (last_error_code IS NOT NULL), updated_at`) doesn't match `storage_assets_backup_due_idx` (`verified_at, id`, partial on literal values), so that index has 0 uses. The backup bucket isn't set up yet, so 9,808 of 9,837 assets are "pending" and the job keeps going over all of them. The older `project_nodes` full scans (719 M rows read) **have stopped**: no new ones since yesterday, the newer indexes are being used. | `0021_storage_backup_due_index`: index that matches the job's filter and order. Plus a code change: the job uses literal values and does nothing while no backup bucket is configured. |
| **D1** | Medium, data | 9 status/role columns are plain text with no rule, so a typo gets saved: `project_members.role` (owner 20, member 3; code also uses admin), `projects.visibility`, `projects.sync_status`, `tasks.review_status`, `project_update_drafts.visibility`, `profile_skills.visibility`, `user_notifications.kind`, `upload_intents.kind`, `project_nodes.type`. Live data is clean today. | `0022_status_role_checks`: `CHECK (col IN (…)) NOT VALID`, then `VALIDATE`. Allowed values come from the app code. |
| **P2** | Medium, write cost | **30 indexes are redundant**: each is the first part of a longer index on the same table, so the longer one already does its job. `project_nodes` carries 28 indexes, including `project_nodes_deleted_at_partial_idx`, which only ever stores NULL. Every insert and update pays for all of them. | `0023_drop_redundant_indexes`: `DROP INDEX CONCURRENTLY` for the 30 + the NULL one. The 187 "never used" indexes stay until there's real traffic. |
| **L1** | Low | `projects_description_search_idx` is 4.6 MB for 15 rows (table is 80 kB). | Not a file: one `REINDEX INDEX CONCURRENTLY` command. |
| **L2** | Low | `anon` can `SELECT` `user_notifications` and `connections`. Policies return nothing to anon today, but no public page needs them. | `0024_revoke_unused_anon_grants`. |

The 30 redundant indexes: `comment_mentions_comment_idx`, `connection_suggestions_user_score_idx`, `connections_addressee_idx`, `connections_requester_idx`, `connections_status_idx`, `onboarding_events_user_id_idx`, `onboarding_submissions_user_id_idx`, `profile_audit_events_user_id_idx`, `project_docs_project_idx`, `project_follows_project_id_idx`, `project_members_project_idx`, `project_members_user_idx`, `project_node_locks_locked_by_idx`, `project_node_locks_project_id_idx`, `project_nodes_project_id_idx`, `project_open_roles_project_idx`, `project_sprints_project_idx`, `project_update_likes_update_idx`, `projects_created_at_idx`, `projects_owner_idx`, `projects_status_idx`, `skill_aliases_search_idx`, `task_comment_likes_comment_id_idx`, `task_comments_parent_id_idx`, `task_comments_task_id_idx`, `task_node_links_task_id_idx`, `task_pushes_task_idx`, `task_subtasks_task_id_idx`, `tasks_assignee_idx`, `tasks_project_idx`.

## 4. What's checked and clean

- Every `public` table has RLS on. Every table has a primary key.
- 43 tables have RLS on and no policies, which means the server only, no browser access. That's on purpose (`0199_browser_roles_read_only`).
- No duplicate indexes, no duplicate triggers, no repeated permissive policies for the same role and action (apart from S1).
- Every `SECURITY DEFINER` function has a fixed `search_path`, and none can be called by `anon`.
- No write policy is open to everyone (`USING (true)`).
- Every foreign key is backed by an index. 7 two-column keys use an index on their second column, which is enough for delete checks. No key to `profiles`/`projects` blocks deletes (409 cascade, 84 set null, 9 restrict, 2 no action overall).
- No `int4` serial keys (no overflow risk). All 8 enum types are used.
- Link tables were checked for duplicate rows: 0 found.
- The new columns from 0257–0263 have their foreign keys and indexes.

## 5. Approaches considered

| Approach | Result | Verdict |
|---|---|---|
| A. Rename each file and delete the dead ones | about 170 files. Still can't build from zero, and still doesn't show the names live uses (0171). Needs the same journal switch. | Same risk, little gain |
| B. One file from live | 1 file, about 25,000 lines. Safe, but nothing is findable. | Too coarse |
| **C. 19 files by area, written from live, proven by diff** | Each file named after the part of the app it holds. Builds from zero. | **Chosen** |

Why C is safe: the new files are **written from the live schema**, not pieced together from the old files. Appendix A is the record of where each old file's content went; correctness comes from one check: **a database built from the new files must equal live, with zero differences.** If it doesn't, nothing is switched.

## 6. The new files

| New file | Holds | Tables | Indexes | Policies | Old files feeding it |
|---|---|---:|---:|---:|---:|
| `0001_foundation.sql` | schemas, extensions, 8 enum types, shared helpers, migration journal, job tables | 4 | 6 | 0 | 12 |
| `0002_profiles_accounts.sql` | profiles, usernames (+ reserved names), account security, deletion, legal acceptance, the `auth.users` trigger | 8 | 41 | 15 | 40 |
| `0003_storage.sql` | storage assets, quotas, repair queues, buckets and `storage.objects` rules | 6 | 29 | 0 | 4 |
| `0004_onboarding.sql` | onboarding drafts, events, submissions | 3 | 13 | 5 | 10 |
| `0005_skills.sql` | skill catalog tables, aliases, icons, proposals, profile skills | 6 | 26 | 7 | 4 |
| `0006_projects_members.sql` | projects (organizations are projects too), members, open roles and units, applications, invitations, follows, tags, access helpers | 13 | 89 | 20 | 53 |
| `0007_organizations.sql` | org invites, handle holds, join blocks | 3 | 12 | 0 | 2 |
| `0008_tasks_sprints.sql` | tasks, subtasks, comments, sprints, workflow columns, task events | 14 | 83 | 23 | 38 |
| `0009_files.sql` | file tree (`project_nodes`), versions, locks, conflicts, file index, upload intents | 9 | 78 | 20 | 46 |
| `0010_docs.sql` | project docs, versions, opens, sprint materials | 4 | 20 | 8 | 12 |
| `0011_github_imports.sql` | GitHub sync and import jobs | 7 | 22 | 0 | 7 |
| `0012_updates.sql` | project updates, comments, likes, drafts, media | 6 | 35 | 10 | 17 |
| `0013_contributions.sql` | profile contributions (portfolio), stages, drafts, media, skills, collaboration summaries | 6 | 31 | 6 | 13 |
| `0014_messaging.sql` | chat channels, members, messages (32 partitions each for messages, reactions, attachments), pins, reports, all chat functions | 14 | 49 | 14 | 22 |
| `0015_connections.sql` | connections, suggestions, dismissals | 3 | 22 | 4 | 20 |
| `0016_notifications_email.sql` | in-app notifications, deliveries, push, email outbox, suppressions, webhooks | 6 | 31 | 3 | 11 |
| `0017_browser_extension.sql` | extension device sessions, recovery sessions and drafts | 4 | 21 | 4 | 10 |
| `0018_moderation.sql` | content reports | 1 | 7 | 0 | 2 |
| `0019_skill_catalog_1_3_7.sql` | the market skill catalog rows, release 1.3.7, written in full (reference data only, no user data) | 0 | 0 | 0 | 1 |

An old file that touched several areas feeds several new files, so the last column adds up to more than 176.

**Rules for writing them**
1. Files run 0001 → 0019, each building on the earlier ones.
2. **Anything that links two areas goes in the later of the two files.** That's 2 foreign keys (`profiles → storage_assets` goes in 0003, `project_node_locks → extension_device_sessions` goes in 0017) and 12 triggers whose function belongs to a later feature: the chat-card triggers on `tasks`, `role_applications` and `project_invitations`, plus `drop_chat_of_deleted_project` on `projects`, all go in 0014. `seed_project_workflow_columns` on `projects` goes in 0008, and the 6 notification-cleanup triggers go in 0016. Checked: no policy calls a helper from a later file.
3. Each file starts with `SET LOCAL check_function_bodies = off` (as `pg_dump` does), so a helper can mention a table created later in the same run.
4. Statements are separated by `--> statement-breakpoint`, the way `scripts/setup-database.ts` reads files. Indexes use plain `CREATE INDEX` (not `CONCURRENTLY`): the files only ever run on empty databases, and live marks them applied without running them.
5. Pieces outside `public`/`app_private` are written out on purpose: the `auth.users` trigger `nb_sync_email_verified_claim` (0002), the 14 `reserved_usernames` rows (0002), the 8 storage buckets and 6 `storage.objects`/`realtime.messages` policies (the file of the feature they serve), and the realtime publication (each table's own file).
6. **`0019_skill_catalog_1_3_7`** holds the full 1.3.7 catalog (categories, icons, skills, aliases). It's the generator's own statement list for 1.3.7 (`scripts/generate-skill-catalog.ts`, `SKILL_CATALOG_VERSION = '1.3.7'`) written out without the "only changes" filter. The next release then works unchanged: the generator compares against every `*_skill_catalog_X_Y_Z.sql` line by line. User-proposed skills are user data and are not in it. Step 2's row-by-row compare proves it equals live.
7. Every file opens with a short header saying what it holds and which tables.

## 7. Every table

All 117 live tables, grouped by new file.
- **Browser**: what signed-in users can do through the Supabase API. "server only" means no grant, so only the server touches the table.
- **Idx**: total indexes (never used since 2025-12-08 / redundant).
- **Hist**: how many migration files changed the table.
- **Issues**: codes from §3.

### 0001_foundation

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `app_migration_journal` | 268 | 160 kB | 8 | 2 (0 / 0) | 0 | server only |  | — | legacy | 0 |  |
| `counter_flush_batches` | 14 | 48 kB | 4 | 2 (0 / 0) | 0 | server only |  | — | 0214 | 1 |  |
| `job_heartbeats` | 8 | 64 kB | 4 | 1 (0 / 0) | 0 | server only |  | — | 0072 | 1 |  |
| `work_leases` | 0 | 16 kB | 6 | 1 (0 / 0) | 0 | server only |  | — | 0213 | 1 |  |

### 0002_profiles_accounts

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `account_deletions` | 0 | 40 kB | 14 | 4 (0 / 0) | 1 | server only |  | — | 0074 | 4 |  |
| `legal_acceptances` | 2 | 80 kB | 9 | 4 (0 / 0) | 0 | server only |  | — | 0162 | 2 |  |
| `profile_audit_events` | 22885 | 13 MB | 7 | 7 (0 / 1) | 1 | server only |  | profiles | 0020 | 6 | **P2** ×1 |
| `profile_security_states` | 13 | 48 kB | 6 | 2 (1 / 0) | 4 | server only |  | profiles | 0061 | 2 |  |
| `profiles` | 16 | 696 kB | 52 | 16 (7 / 0) | 3 | read + anon | yes | storage_assets | 0000 | 31 |  |
| `recovery_code_redemptions` | 0 | 32 kB | 4 | 3 (1 / 0) | 2 | server only |  | profiles | 0062 | 1 |  |
| `reserved_usernames` | 14 | 32 kB | 3 | 1 (0 / 0) | 0 | server only |  | — | 0020 | 2 |  |
| `username_aliases` | 47 | 80 kB | 5 | 4 (0 / 0) | 4 | server only |  | profiles | 0056 | 3 |  |

### 0003_storage

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `storage_asset_operations` | 22 | 80 kB | 14 | 4 (1 / 0) | 0 | server only |  | profiles, storage_assets | 0178 | 1 |  |
| `storage_asset_pins` | 0 | 40 kB | 6 | 4 (2 / 0) | 0 | server only |  | storage_assets | 0178 | 1 |  |
| `storage_assets` | 9833 | 10160 kB | 30 | 11 (4 / 0) | 0 | server only |  | — | 0178 | 1 | **P1** |
| `storage_legacy_cleanup_targets` | 0 | 40 kB | 16 | 4 (2 / 0) | 0 | server only |  | — | 0178 | 1 |  |
| `storage_quota_scopes` | 8 | 80 kB | 8 | 2 (1 / 0) | 0 | server only |  | — | 0178 | 1 |  |
| `storage_repair_failures` | 2358 | 1872 kB | 10 | 4 (1 / 0) | 0 | server only |  | — | 0178 | 1 |  |

### 0004_onboarding

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `onboarding_drafts` | 0 | 96 kB | 9 | 3 (2 / 0) | 1 | server only |  | profiles | 0020 | 6 |  |
| `onboarding_events` | 1 | 440 kB | 6 | 5 (0 / 1) | 1 | server only |  | profiles | 0020 | 4 | **P2** ×1 |
| `onboarding_submissions` | 7 | 96 kB | 9 | 5 (3 / 1) | 3 | server only |  | profiles | 0020 | 7 | **P2** ×1 |

### 0005_skills

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `profile_skills` | 8 | 112 kB | 11 | 4 (0 / 0) | 1 | server only |  | profiles, skills | 0023 | 3 | **D1** visibility |
| `skill_aliases` | 1312 | 1280 kB | 8 | 4 (1 / 1) | 1 | server only |  | skills | 0103 | 1 | **P2** ×1 |
| `skill_categories` | 25 | 96 kB | 9 | 3 (0 / 0) | 1 | server only |  | — | 0103 | 1 |  |
| `skill_icon_assets` | 758 | 624 kB | 15 | 1 (0 / 0) | 1 | server only |  | — | 0103 | 10 |  |
| `skill_proposals` | 15 | 96 kB | 11 | 5 (3 / 0) | 2 | server only |  | profiles, skills | 0103 | 2 |  |
| `skills` | 1180 | 1784 kB | 19 | 9 (3 / 0) | 1 | server only |  | skill_categories | 0023 | 13 |  |

### 0006_projects_members

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `application_events` | 7 | 80 kB | 10 | 4 (1 / 0) | 1 | server only |  | profiles, role_applications | 0129 | 1 |  |
| `project_event_counters` | 15 | 56 kB | 3 | 1 (0 / 0) | 0 | server only |  | projects | 0178 | 1 |  |
| `project_follows` | 5 | 104 kB | 4 | 4 (1 / 1) | 4 | read + anon |  | profiles, projects | 0003 | 4 | **P2** ×1 |
| `project_guidance_appointments` | 0 | 64 kB | 15 | 7 (3 / 0) | 1 | server only |  | profiles, project_invitations, projects | 0143 | 4 |  |
| `project_invitations` | 1 | 168 kB | 18 | 10 (4 / 0) | 1 | server only |  | profiles, project_open_roles, projects | 0143 | 6 |  |
| `project_members` | 23 | 152 kB | 11 | 7 (1 / 2) | 1 | read + anon |  | profiles, project_open_roles, projects | 0000 | 9 | **D1** role · **P2** ×2 |
| `project_open_roles` | 10 | 72 kB | 14 | 4 (1 / 1) | 4 | server only |  | profiles, projects | 0003 | 7 | **P2** ×1 |
| `project_skills` | 16 | 96 kB | 8 | 4 (0 / 0) | 1 | server only |  | projects, skills | 0023 | 5 |  |
| `project_tags` | 29 | 56 kB | 4 | 3 (1 / 0) | 1 | server only |  | projects, tags | 0023 | 4 |  |
| `projects` | 15 | 5432 kB | 69 | 25 (8 / 3) | 3 | server only | yes | profiles, storage_assets | 0000 | 36 | **D1** visibility, sync_status · **P2** ×3 · **L1** |
| `role_applications` | 5 | 208 kB | 15 | 12 (5 / 0) | 1 | server only |  | profiles, project_open_roles, projects | 0006 | 23 |  |
| `role_skills` | 1 | 80 kB | 8 | 4 (0 / 0) | 1 | server only |  | project_open_roles, skills | 0103 | 2 |  |
| `tags` | 17 | 88 kB | 4 | 4 (0 / 0) | 1 | server only |  | — | 0023 | 2 |  |

### 0007_organizations

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `org_email_invites` | 0 | 64 kB | 11 | 7 (5 / 0) | 0 | server only |  | profiles, project_open_roles, projects | 0241 | 2 |  |
| `org_handle_holds` | 0 | 24 kB | 4 | 2 (1 / 0) | 0 | server only |  | projects | 0241 | 1 |  |
| `org_join_blocks` | 0 | 24 kB | 4 | 3 (2 / 0) | 0 | server only |  | profiles, projects | 0241 | 2 |  |

### 0008_tasks_sprints

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `comment_mentions` | 0 | 32 kB | 4 | 4 (1 / 1) | 2 | server only |  | profiles, task_comments | 0070 | 1 | **P2** ×1 |
| `project_sprint_events` | 2 | 80 kB | 7 | 4 (2 / 0) | 0 | server only |  | profiles, project_sprints, projects | 0145 | 1 |  |
| `project_sprints` | 1 | 152 kB | 20 | 9 (2 / 1) | 4 | server only |  | profiles, projects | 0003 | 9 | **P2** ×1 |
| `project_task_policy_events` | 2 | 56 kB | 6 | 3 (1 / 0) | 0 | server only |  | profiles, projects | 0233 | 1 |  |
| `project_workflow_columns` | 60 | 128 kB | 11 | 4 (0 / 0) | 1 | read + anon | yes | projects | 0139 | 4 |  |
| `sprint_task_memberships` | 2 | 120 kB | 8 | 7 (5 / 0) | 0 | server only |  | profiles, project_sprints, projects, tasks | 0149 | 2 |  |
| `task_activity_events` | 74 | 152 kB | 8 | 6 (3 / 0) | 0 | server only |  | profiles, project_sprints, projects, tasks | 0137 | 4 |  |
| `task_comment_likes` | 1 | 72 kB | 4 | 4 (1 / 1) | 4 | read + anon | yes | profiles, task_comments | 0008 | 7 | **P2** ×1 |
| `task_comments` | 4 | 144 kB | 9 | 8 (4 / 2) | 4 | read + anon | yes | profiles, tasks | 0008 | 12 | **P2** ×2 |
| `task_pushes` | 1 | 96 kB | 8 | 5 (3 / 1) | 0 | server only |  | profiles, projects, tasks | 0153 | 2 | **P2** ×1 |
| `task_read_receipts` | 3 | 40 kB | 3 | 2 (0 / 0) | 0 | server only |  | profiles, tasks | 0153 | 1 |  |
| `task_subtasks` | 4 | 72 kB | 8 | 4 (1 / 1) | 4 | read + anon | yes | profiles, tasks | 0006 | 7 | **P2** ×1 |
| `task_team_members` | 0 | 16 kB | 4 | 2 (1 / 0) | 0 | server only |  | profiles, tasks | 0244 | 1 |  |
| `tasks` | 23 | 416 kB | 32 | 21 (10 / 2) | 4 | read + anon | yes | profiles, project_sprints, project_workflow_columns, projects | 0003 | 21 | **D1** review_status · **P2** ×2 |

### 0009_files

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `file_versions` | 9798 | 9792 kB | 12 | 7 (1 / 0) | 2 | server only |  | profiles, project_nodes, storage_assets | 0068 | 7 |  |
| `project_file_index` | 6 | 232 kB | 4 | 3 (1 / 0) | 4 | server only |  | project_nodes, projects | 0004 | 6 |  |
| `project_git_deltas` | 0 | 56 kB | 19 | 6 (1 / 0) | 0 | server only |  | file_versions, project_nodes, projects, tasks | 0086 | 2 |  |
| `project_node_conflicts` | 0 | 40 kB | 10 | 4 (1 / 0) | 0 | server only |  | project_nodes, projects, tasks | 0086 | 2 |  |
| `project_node_events` | 9964 | 8176 kB | 8 | 7 (0 / 0) | 4 | server only |  | profiles, project_nodes, projects | 0004 | 15 |  |
| `project_node_locks` | 0 | 216 kB | 11 | 10 (3 / 2) | 1 | read + anon | yes | extension_device_sessions, profiles, project_nodes, projects | 0004 | 8 | **P2** ×2 |
| `project_nodes` | 30562 | 57 MB | 22 | 28 (2 / 1) | 4 | server only |  | profiles, projects, storage_assets, tasks | 0003 | 26 | **D1** type · **P2** ×1 · **P2** NULL-only index; 28 indexes |
| `task_node_links` | 6 | 112 kB | 8 | 6 (0 / 1) | 4 | read + anon | yes | profiles, project_nodes, tasks | 0004 | 12 | **P2** ×1 |
| `upload_intents` | 58 | 232 kB | 19 | 7 (1 / 0) | 1 | server only |  | profiles, projects, storage_assets | 0062 | 4 | **D1** kind |

### 0010_docs

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `doc_opens` | 0 | 16 kB | 4 | 2 (1 / 0) | 0 | server only |  | profiles, project_docs | 0246 | 1 |  |
| `project_doc_versions` | 17 | 632 kB | 14 | 5 (1 / 0) | 4 | server only |  | profiles, project_docs, projects | 0072 | 7 |  |
| `project_docs` | 9 | 216 kB | 9 | 6 (0 / 1) | 4 | server only |  | project_doc_versions, project_nodes, projects | 0072 | 9 | **P2** ×1 |
| `sprint_materials` | 0 | 56 kB | 6 | 7 (4 / 0) | 0 | server only |  | profiles, project_docs, project_nodes, project_sprints | 0243 | 2 |  |

### 0011_github_imports

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `github_contributor_identities` | 2 | 48 kB | 7 | 2 (0 / 0) | 0 | server only |  | profiles | 0161 | 2 |  |
| `github_sync_connections` | 1 | 32 kB | 8 | 1 (0 / 0) | 0 | server only |  | projects | 0161 | 2 |  |
| `github_sync_files` | 2261 | 2256 kB | 10 | 4 (1 / 0) | 0 | server only |  | project_nodes, projects | 0161 | 3 |  |
| `github_sync_runs` | 7 | 944 kB | 13 | 5 (1 / 0) | 0 | server only |  | profiles, projects | 0161 | 3 |  |
| `github_sync_snapshot_assets` | 0 | 64 kB | 4 | 3 (1 / 0) | 0 | server only |  | github_sync_runs, storage_assets | 0178 | 1 |  |
| `import_job_files` | 0 | 32 kB | 11 | 3 (0 / 0) | 0 | server only |  | import_jobs, upload_intents | 0086 | 2 |  |
| `import_jobs` | 0 | 40 kB | 12 | 4 (2 / 0) | 0 | server only |  | projects, storage_assets, upload_intents | 0086 | 3 |  |

### 0012_updates

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `project_update_comments` | 5 | 176 kB | 11 | 10 (6 / 0) | 3 | read + anon | yes | profiles, project_updates, projects | 0063 | 9 |  |
| `project_update_draft_media_assets` | 0 | 24 kB | 5 | 3 (1 / 0) | 0 | server only |  | project_update_drafts, storage_assets | 0178 | 1 |  |
| `project_update_drafts` | 2 | 96 kB | 8 | 3 (2 / 0) | 1 | server only |  | profiles, projects | 0082 | 3 | **D1** visibility |
| `project_update_likes` | 7 | 72 kB | 4 | 4 (2 / 1) | 3 | server only |  | profiles, project_updates | 0063 | 1 | **P2** ×1 |
| `project_update_media_assets` | 1 | 72 kB | 5 | 4 (0 / 0) | 0 | server only |  | project_updates, storage_assets | 0178 | 1 |  |
| `project_updates` | 10 | 184 kB | 22 | 11 (6 / 0) | 3 | read + anon | yes | profiles, projects | 0063 | 11 |  |

### 0013_contributions

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `profile_collaboration_summaries` | 10 | 256 kB | 9 | 3 (2 / 0) | 1 | server only |  | profiles | 0076 | 2 |  |
| `profile_contribution_drafts` | 4 | 80 kB | 4 | 2 (1 / 0) | 1 | server only |  | profile_project_contributions, profiles | 0237 | 1 |  |
| `profile_contribution_media_assets` | 1 | 40 kB | 2 | 2 (0 / 0) | 1 | server only |  | profile_project_contributions, storage_assets | 0237 | 1 |  |
| `profile_contribution_skills` | 36 | 128 kB | 9 | 5 (1 / 0) | 1 | server only |  | profile_project_contributions, profiles, skills | 0103 | 4 |  |
| `profile_project_contribution_stages` | 23 | 176 kB | 20 | 10 (5 / 0) | 1 | server only |  | profile_project_contributions, profiles, projects | 0077 | 7 |  |
| `profile_project_contributions` | 24 | 208 kB | 26 | 9 (3 / 0) | 1 | server only |  | profiles, projects | 0076 | 10 |  |

### 0014_messaging

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `chat_attachments` (+32 partitions) | 3 | 816 kB | 10 | 2 (0 / 0) | 1 | server only |  | chat_messages, storage_assets | 0180 | 2 |  |
| `chat_canvases` | 1 | 72 kB | 7 | 3 (2 / 0) | 1 | server only |  | chat_channels, profiles | 0182 | 2 |  |
| `chat_channel_members` | 32 | 48 kB | 9 | 2 (0 / 0) | 1 | server only |  | chat_channels, profiles | 0180 | 1 |  |
| `chat_channel_tabs` | 1 | 88 kB | 8 | 5 (1 / 0) | 1 | server only |  | chat_channels, profiles | 0187 | 3 |  |
| `chat_channels` | 20 | 144 kB | 19 | 8 (1 / 0) | 1 | server only |  | profiles, projects, role_applications | 0180 | 3 |  |
| `chat_mentions` | 1 | 80 kB | 6 | 4 (1 / 0) | 1 | server only |  | chat_messages, profiles | 0180 | 4 |  |
| `chat_message_cards` | 3 | 48 kB | 5 | 2 (0 / 0) | 1 | server only |  | chat_messages | 0180 | 2 |  |
| `chat_messages` (+32 partitions) | 51 | 2048 kB | 14 | 5 (0 / 0) | 1 | server only |  | chat_channels, profiles | 0180 | 5 |  |
| `chat_pins` | 0 | 32 kB | 4 | 2 (1 / 0) | 1 | server only |  | chat_messages, profiles | 0180 | 2 |  |
| `chat_reactions` (+32 partitions) | 11 | 888 kB | 5 | 2 (0 / 0) | 1 | server only |  | chat_messages, profiles | 0180 | 2 |  |
| `chat_reports` | 0 | 40 kB | 7 | 4 (2 / 0) | 1 | server only |  | chat_messages, profiles | 0180 | 2 |  |
| `chat_saved` | 0 | 56 kB | 7 | 4 (1 / 0) | 1 | server only |  | chat_messages, profiles | 0187 | 3 |  |
| `chat_scheduled_messages` | 0 | 40 kB | 10 | 4 (0 / 0) | 1 | server only |  | chat_channels, profiles | 0187 | 3 |  |
| `chat_thread_follows` | 2 | 40 kB | 5 | 2 (0 / 0) | 1 | server only |  | chat_messages, profiles | 0180 | 1 |  |

### 0015_connections

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `connection_suggestion_dismissals` | 0 | 64 kB | 4 | 4 (1 / 0) | 1 | server only |  | profiles | 0020 | 4 |  |
| `connection_suggestions` | 0 | 48 kB | 8 | 5 (1 / 1) | 1 | server only |  | profiles | 0058 | 4 | **P2** ×1 |
| `connections` | 5 | 208 kB | 12 | 13 (12 / 3) | 2 | read + anon |  | profiles | 0000 | 16 | **S1** · **P2** ×3 · **L2** |

### 0016_notifications_email

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `email_outbox` | 15 | 192 kB | 21 | 6 (1 / 0) | 0 | server only |  | profiles | 0205 | 5 |  |
| `email_suppressions` | 0 | 16 kB | 3 | 1 (0 / 0) | 0 | server only |  | — | 0205 | 1 |  |
| `email_webhook_events` | 2 | 48 kB | 5 | 2 (0 / 0) | 0 | server only |  | — | 0205 | 1 |  |
| `notification_deliveries` | 36 | 104 kB | 9 | 5 (2 / 0) | 1 | server only |  | profiles, user_notifications | 0072 | 4 |  |
| `push_subscriptions` | 0 | 40 kB | 10 | 4 (2 / 0) | 1 | server only |  | profiles | 0072 | 2 |  |
| `user_notifications` | 63 | 344 kB | 19 | 13 (1 / 0) | 1 | read + anon | yes | profiles | 0072 | 3 | **D1** kind · **L2** |

### 0017_browser_extension

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `extension_device_session_events` | 102 | 112 kB | 7 | 3 (0 / 0) | 0 | server only |  | extension_device_sessions | 0086 | 4 |  |
| `extension_device_sessions` | 34 | 120 kB | 19 | 4 (0 / 0) | 0 | server only |  | profiles | 0086 | 3 |  |
| `extension_recovery_drafts` | 0 | 192 kB | 22 | 9 (4 / 0) | 4 | server only |  | profiles, project_nodes, projects, storage_assets | 0100 | 3 |  |
| `extension_recovery_sessions` | 44 | 136 kB | 12 | 5 (0 / 0) | 0 | server only |  | profiles | 0102 | 2 |  |

### 0018_moderation

| Table | Rows | Size | Cols | Idx (unused / redundant) | Policies | Browser | Realtime | Links to | Created in | Hist | Issues |
|---|---:|---:|---:|---|---:|---|:---:|---|---|---:|---|
| `content_reports` | 0 | 64 kB | 12 | 7 (5 / 0) | 0 | server only |  | profiles, projects | 0254 | 2 |  |

**Tables that existed once and are gone (67).** None come back:

`posts`, `conversation_participants`, `conversations`, `message_attachments`, `messages`, `saved_projects`, `task_files`, `typing_indicators`, `dm_pairs`, `attachment_uploads`, `message_edit_logs`, `message_hidden_for_users`, `project_run_diagnostics`, `project_run_logs`, `project_run_profiles`, `project_run_sessions`, `collection_projects`, `collections`, `interests`, `profile_interests`, `message_reactions`, `tasks_p0`, `tasks_p1`, `tasks_p2`, `tasks_p3`, `tasks_p4`, `tasks_p5`, `tasks_p6`, `tasks_p7`, `tasks_p8`, `tasks_p9`, `tasks_p10`, `tasks_p11`, `tasks_p12`, `tasks_p13`, `tasks_p14`, `tasks_p15`, `tasks_partitioned`, `messages_p0`, `messages_p1`, `messages_p2`, `messages_p3`, `messages_p4`, `messages_p5`, `messages_p6`, `messages_p7`, `messages_p8`, `messages_p9`, `messages_p10`, `messages_p11`, `messages_p12`, `messages_p13`, `messages_p14`, `messages_p15`, `messages_partitioned`, `profile_counters`, `message_reports`, `message_read_receipts`, `message_workflow_items`, `message_work_links`, `message_delivery_receipts`, `project_doc_assets`, `skill_relationships`, `skill_catalog_releases`, `skill_popularity_snapshots`, `app_private.retired_domain_archive`, `message_pins`

## 8. How to do it

### Step 0 — before starting
- **Migration freeze:** no session adds or edits anything in `drizzle/` until Step 4 is done. Other sessions were still adding files yesterday.
- ✅ All 261 files are live and committed (done today).
- Take a fresh read-only `pg_dump` of live the same day.

### Step 1 — write the 19 files (repo only)
A one-off script reads the live dump and puts every object into its area file, using the table → file map in §7 and the rules in §6. It runs from a scratch folder and isn't added to the repo. The Supabase-managed pieces come from the same read-only queries `scripts/db/dump-baseline.ts` already uses. The catalog seed comes from the generator.

### Step 2 — prove it (throwaway database only)
| Check | Must be |
|---|---|
| Empty Postgres 17 + `scripts/db/supabase-shim.sql` + files 0001–0019 | runs with no errors |
| `pg_dump` of `public` + `app_private` vs live | **0 differences** |
| Grants, storage/realtime policies, buckets, realtime list, `auth.users` triggers vs live | identical (same query used in this review) |
| Catalog and reserved-username rows vs live, compared row by row | identical |
| `npm run check:db:remigration-replay`, `check:db-catalog-drift`, `check:rls-contract`, `check:sql-governance`, `check:db:migration-journal` | pass |
| Unit and db test suites | pass |

If any check fails, fix the script and run Step 2 again. Live is never touched in this step.

### Step 3 — update everything that names old files (repo only)
| What | Change |
|---|---|
| `drizzle/meta/_journal.json` | 19 entries |
| `standards/sql-governance.manifest.json` | `existingMigrationFiles` = the 19 paths, `legacyDatabaseTags` emptied, `strictLineageFromIndex` = 0 |
| 34 test and script files that read 60 specific old files (`tests/unit/*-contract.test.ts`, `tests/db/*`, `scripts/check-rls-contract.ts`, `scripts/check-onboarding-slo.ts`, `scripts/deploy-*.mjs`, and comments in `src/lib/db/schema/index.ts` and `src/lib/messaging/constants.ts`) | Each one points at the new file that now holds what it checks. Tests that only guard a past step (e.g. "0180 is additive") are deleted. Done file by file, not by search-and-replace. |
| `scripts/db/baseline/schema.sql`, `scripts/db/adopt-baseline.ts`, `scripts/db/dump-baseline.ts` | Deleted: the files now build from zero. `scripts/db/disposable-db.sh` drops its baseline lines. |
| `scripts/generate-skill-catalog.ts` | One-off run that writes the full 1.3.7 list (rule 6). The script itself doesn't change. |
| `scripts/setup-database.ts` `NON_TRANSACTIONAL_MIGRATIONS` | Lists 9 old tags that use `CONCURRENTLY`. It becomes empty for the 19 files; later, `0023_drop_redundant_indexes` is added to it. |
| The 261 old files | Deleted from the tree. Git keeps them; the commit before the switch is tagged `sql-pre-consolidation`. |

### Step 4 — switch live (one transaction, bookkeeping table only)
```sql
BEGIN;
CREATE TABLE app_private.app_migration_journal_pre_consolidation AS TABLE public.app_migration_journal;  -- backup: 268 rows
DELETE FROM public.app_migration_journal;
INSERT INTO public.app_migration_journal (tag, journal_index, checksum, status, started_at, completed_at) VALUES
  ('0001_foundation', 0, '<sha256 of file>', 'completed', now(), now()),
  …
  ('0019_skill_catalog_1_3_7', 18, '<sha256 of file>', 'completed', now(), now());
COMMIT;
```
- No table, column, index, policy or row of app data changes.
- Afterwards, `npm run check:db:migration-sources` (dry run) and `check:db:live-lineage` must report 19 applied, 0 pending, 0 differences.
- **Undo:** `DELETE FROM public.app_migration_journal; INSERT INTO public.app_migration_journal SELECT * FROM app_private.app_migration_journal_pre_consolidation;`, then check out the tag `sql-pre-consolidation`. Drop the backup table after a week.

### Step 5 — the fixes
- `0020_connections_block_visibility` (S1)
- `0021_storage_backup_due_index` (P1, plus the job code change)
- `0022_status_role_checks` (D1)
- `0023_drop_redundant_indexes` (P2; non-transactional, listed in `NON_TRANSACTIONAL_MIGRATIONS`)
- `0024_revoke_unused_anon_grants` (L2)
- L1 is one command, not a file.

Each is tested on a throwaway DB, then applied live with your OK. **Total: 24 files.**

### From then on
One change, one file, a name that says what it does (`0025_add_org_invite_expiry`), never edited after it's applied.

## 9. Risks and limits

| Risk | How it's handled |
|---|---|
| Something on live isn't captured | Step 2 compares schema, grants, storage/realtime policies, buckets, realtime list, `auth.users` triggers and reference rows. These are all the places this app's migrations have ever written to. |
| Another session adds a migration mid-way | The freeze. A file that slips in after Step 1 becomes 0020+ instead of being lost. |
| A test quietly stops checking something | The 34 files are updated one by one, by name, in the same commit. |
| A deploy applies old files | Deploys don't run migrations (`Dockerfile`, `railway.toml`). `db:setup` is run by hand. |
| "Never used" index stats are thin | Only the 30 *redundant* indexes are dropped. Index usage gets checked again once there's real traffic. |

Not covered: things Supabase changes on its side, and performance under real load (the data is still small). P1 and P2 are the parts that matter most for 1M users; S1 is the only security problem.

---

## Appendix A — all 261 files

**Status** says what's left of the file on live today. **Action** is merge or remove. For a merge, the last column is the new file(s) its content goes to; for a remove, it's why.

| # | Old file | Lines | Status | Action | Goes to / why |
|---:|---|---:|---|---|---|
| 1 | `0000_medical_the_liberteens` | 76 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0015_connections` |
| 2 | `0001_remarkable_mattie_franklin` | 17 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0015_connections` |
| 3 | `0002_spotty_paladin` | 1 | cleanup only | **remove** | only drops things |
| 4 | `0003_ambitious_skin` ⚠ dup no. | 165 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files` |
| 5 | `0004_harsh_randall` ⚠ dup no. | 75 | still used | merge | `0009_files` |
| 6 | `0005_spooky_romulus` ⚠ dup no. | 5 | still used | merge | `0008_tasks_sprints` |
| 7 | `0006_furry_susan_delgado` ⚠ dup no. | 51 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files` |
| 8 | `0007_typing_indicators` | 75 | dropped later | **remove** | everything it made was dropped |
| 9 | `0008_task_features` | 224 | still used | merge | `0008_tasks_sprints` |
| 10 | `0009_fix_rls_policies` | 137 | dropped later | **remove** | everything it made was dropped |
| 11 | `0013_task_node_links` | 19 | still used | merge | `0009_files` |
| 12 | `0014_project_file_index` | 42 | still used | merge | `0009_files` |
| 13 | `0015_project_node_locks` | 50 | still used | merge | `0009_files` |
| 14 | `0016_project_nodes_trash_and_events` | 72 | still used | merge | `0009_files` |
| 15 | `0017_drop_task_files` | 6 | cleanup only | **remove** | only drops things |
| 16 | `0018_role_applications_message_and_constraints` | 40 | still used | merge | `0006_projects_members` |
| 17 | `0019_messaging_rls_and_realtime` ⚠ dup no. | 142 | dropped later | **remove** | everything it made was dropped |
| 18 | `0020_dm_pairs` ⚠ dup no. | 23 | dropped later | **remove** | everything it made was dropped |
| 19 | `0021_add_project_conversation_id` ⚠ dup no. | 11 | dropped later | **remove** | everything it made was dropped |
| 20 | `0019_demonic_bloodscream` ⚠ dup no. | 2 | still used | merge | `0006_projects_members` |
| 21 | `0020_damp_shatterstar` ⚠ dup no. | 231 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_projects_members`, `0009_files`, `0015_connections` |
| 22 | `0021_faithful_warstar` ⚠ dup no. | 17 | dropped later | **remove** | everything it made was dropped |
| 23 | `0022_handy_tombstone` ⚠ dup no. | 35 | still used | merge | `0008_tasks_sprints`, `0009_files` |
| 24 | `0023_little_quasimodo` ⚠ dup no. | 106 | still used | merge | `0002_profiles_accounts`, `0005_skills`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files` |
| 25 | `0003_messaging` ⚠ dup no. | 282 | dropped later | **remove** | everything it made was dropped |
| 26 | `0004_chat_storage` ⚠ dup no. | 78 | dropped later | **remove** | everything it made was dropped |
| 27 | `0004_message_reactions` ⚠ dup no. | 126 | dropped later | **remove** | everything it made was dropped |
| 28 | `0005_enable_connections_realtime` ⚠ dup no. | 3 | grants/rls only | merge | `0015_connections` |
| 29 | `0006_messages_performance_indexes` ⚠ dup no. | 95 | dropped later | **remove** | everything it made was dropped |
| 30 | `0022_messaging_reliability_and_scale` ⚠ dup no. | 132 | dropped later | **remove** | everything it made was dropped |
| 31 | `0023_message_attachments_storage_path` ⚠ dup no. | 24 | dropped later | **remove** | everything it made was dropped |
| 32 | `0024_attachment_upload_sessions` | 33 | dropped later | **remove** | everything it made was dropped |
| 33 | `0025_message_actions_edit_delete` | 37 | dropped later | **remove** | everything it made was dropped |
| 34 | `0026_project_members_unique` | 22 | still used | merge | `0006_projects_members` |
| 35 | `0027_task_node_links_unique` | 24 | still used | merge | `0009_files` |
| 36 | `0028_project_follow_counts` | 46 | still used | merge | `0006_projects_members` |
| 37 | `0029_workspace_layout` | 7 | still used | merge | `0002_profiles_accounts` |
| 38 | `0030_message_reply_and_preview` | 33 | dropped later | **remove** | everything it made was dropped |
| 39 | `0031_connection_suggestion_dismissals` | 33 | still used | merge | `0015_connections` |
| 40 | `0032_project_runner_sessions` | 176 | dropped later | **remove** | everything it made was dropped |
| 41 | `0033_onboarding_username_guardrails` | 74 | still used | merge | `0002_profiles_accounts`, `0009_files` |
| 42 | `0034_onboarding_reliability_and_telemetry` | 120 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0012_updates` |
| 43 | `0035_onboarding_submission_integrity` | 281 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0012_updates` |
| 44 | `0036_onboarding_claims_repair_queue` | 6 | still used | merge | `0004_onboarding` |
| 45 | `0037_onboarding_submissions_updated_at_trigger` | 30 | dropped later | **remove** | everything it made was dropped |
| 46 | `0038_profile_audit_events` | 19 | still used | merge | `0002_profiles_accounts` |
| 47 | `0039_files_workspace_scale_indexes` | 53 | still used | merge | `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 48 | `0040_projects_github_columns` | 30 | still used | merge | `0006_projects_members`, `0009_files` |
| 49 | `0041_username_rules_schema_qualification` | 24 | still used | merge | `0009_files` |
| 50 | `0042_schema_hardening_constraints_and_fks` | 205 | replaced later | **remove** | replaced by a later file |
| 51 | `0043_project_files_key_policy_dual_read` | 102 | dropped later | **remove** | everything it made was dropped |
| 52 | `0044_onboarding_profile_extended_preferences` | 71 | still used | merge | `0002_profiles_accounts` |
| 53 | `0051_clever_scarecrow` | 138 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
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
| 64 | `0061_profile_security_state_privacy_rls` | 100 | still used | merge | `0002_profiles_accounts` |
| 65 | `0062_upload_intents_and_recovery_redemptions` | 102 | still used | merge | `0002_profiles_accounts`, `0009_files` |
| 66 | `0063_database_setup_authority_backfill` | 756 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_projects_members`, `0009_files`, `0012_updates`, `0015_connections` |
| 67 | `0064_messaging_reactions_reports_receipts_rls` | 137 | dropped later | **remove** | everything it made was dropped |
| 68 | `0065_profile_security_recovery_factor_binding` | 25 | still used | merge | `0002_profiles_accounts` |
| 69 | `0066_message_delivery_receipts` | 126 | dropped later | **remove** | everything it made was dropped |
| 70 | `0067_read_receipts_conversation_id` | 87 | dropped later | **remove** | everything it made was dropped |
| 71 | `0068_file_versions` | 142 | still used | merge | `0009_files` |
| 72 | `0069_project_nodes_current_version` | 44 | still used | merge | `0009_files` |
| 73 | `0070_comment_mentions` | 106 | still used | merge | `0008_tasks_sprints` |
| 74 | `0071_realtime_publication_extension` | 26 | does nothing | **remove** | no effect left |
| 75 | `0072_user_notifications` | 568 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0010_docs`, `0015_connections`, `0016_notifications_email` |
| 76 | `0073_message_reactions_conversation_scope` | 31 | dropped later | **remove** | everything it made was dropped |
| 77 | `0074_v2_schema_optimizations` | 252 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections`, `0016_notifications_email` |
| 78 | `0075_review_optimization_indexes` | 81 | still used | merge | `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 79 | `0076_profile_collaboration_projection` | 187 | still used | merge | `0013_contributions` |
| 80 | `0077_profile_collaboration_role_stages` | 132 | still used | merge | `0013_contributions` |
| 81 | `0078_public_rls_security_hardening` | 899 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0005_skills`, `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0010_docs`, `0015_connections`, `0016_notifications_email` |
| 82 | `0079_profile_column_privilege_hardening` | 44 | grants/rls only | merge | its grants are written into the owning table's new file |
| 83 | `0080_profile_write_privilege_hardening` | 41 | grants/rls only | merge | its grants are written into the owning table's new file |
| 84 | `0081_project_updates_realtime` | 43 | does nothing | **remove** | no effect left |
| 85 | `0082_project_update_drafts` | 33 | still used | merge | `0012_updates` |
| 86 | `0083_project_update_drafts_rls` | 54 | dropped later | **remove** | everything it made was dropped |
| 87 | `0084_team_invite_collaboration_status` | 6 | dropped later | **remove** | everything it made was dropped |
| 88 | `0085_project_update_media_storage` | 104 | one-time data fix | **remove** | one-time data fix, already applied |
| 89 | `0086_virtual_workspace_fields` | 165 | still used | merge | `0006_projects_members`, `0009_files`, `0011_github_imports`, `0017_browser_extension` |
| 90 | `0087_non_transactional_indexes` | 37 | dropped later | **remove** | everything it made was dropped |
| 91 | `0088_extension_device_session_editor_metadata` | 9 | still used | merge | `0017_browser_extension` |
| 92 | `0089_project_node_event_sequence_trigger` | 42 | still used | merge | `0009_files` |
| 93 | `0090_project_update_comment_threads` | 42 | still used | merge | `0012_updates` |
| 94 | `0091_extension_auth_code_events` | 25 | still used | merge | `0017_browser_extension` |
| 95 | `0092_project_updates_performance_indexes` | 18 | still used | merge | `0012_updates` |
| 96 | `0094_lovely_toad` | 14 | still used | merge | `0012_updates` |
| 97 | `0095_docs_hub_upgrade` | 141 | still used | merge | `0001_foundation`, `0010_docs` |
| 98 | `0098_onboarding_state_machine` | 75 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 99 | `0099_schema_lineage_and_fk_indexes` | 132 | still used | merge | `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0010_docs`, `0011_github_imports`, `0012_updates`, `0013_contributions`, `0015_connections`, `0017_browser_extension` |
| 100 | `0100_extension_recovery_drafts` | 80 | still used | merge | `0017_browser_extension` |
| 101 | `0101_project_file_leases` | 97 | still used | merge | `0009_files` |
| 102 | `0102_extension_recovery_sessions` | 32 | still used | merge | `0017_browser_extension` |
| 103 | `0103_market_skill_catalog` | 266 | still used | merge | `0005_skills`, `0006_projects_members`, `0013_contributions` |
| 104 | `0104_market_skill_seed` | 1884 | seed data | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 105 | `0105_market_skill_catalog_1_0_1` | 1895 | seed data | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 106 | `0106_role_skill_visibility_hardening` | 26 | dropped later | **remove** | everything it made was dropped |
| 107 | `0107_market_skill_catalog_1_1_0` | 3414 | seed data | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 108 | `0108_market_skill_icons_1_2_0` | 3485 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 109 | `0109_skill_catalog_fk_indexes` | 16 | still used | merge | `0005_skills`, `0013_contributions` |
| 110 | `0110_market_skill_icons_1_2_1` | 3520 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 111 | `0111_market_skill_catalog_1_3_0` | 3867 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 112 | `0112_market_skill_catalog_1_3_1` | 3867 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 113 | `0113_market_skill_catalog_1_3_2` | 3903 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 114 | `0114_market_skill_catalog_1_3_3` | 4285 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 115 | `0115_market_skill_catalog_1_3_4` | 4285 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 116 | `0116_market_skill_catalog_1_3_5` | 4284 | replaced later | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 117 | `0117_market_skill_catalog_1_3_6` | 4354 | still used | **remove** | older catalog release; rows written in full in `0019_skill_catalog_1_3_7` |
| 118 | `0118_remove_profile_availability_status` | 23 | dropped later | **remove** | everything it made was dropped |
| 119 | `0119_open_roles_ecosystem` | 59 | still used | merge | `0002_profiles_accounts`, `0006_projects_members` |
| 120 | `0120_ponytail_message_system_cleanup` | 43 | cleanup only | **remove** | only drops things |
| 121 | `0121_ponytail_skill_catalog_table_cleanup` | 24 | dropped later | **remove** | everything it made was dropped |
| 122 | `0122_ponytail_database_hardening` | 972 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0003_storage`, `0006_projects_members`, `0009_files`, `0016_notifications_email` |
| 123 | `0123_ponytail_duplicate_index_completion` | 7 | cleanup only | **remove** | only drops things |
| 124 | `0124_ponytail_storage_bucket_contracts` | 33 | one-time data fix | **remove** | one-time data fix, already applied |
| 125 | `0125_ponytail_realtime_publication_trim` ⚠ dup no. | 27 | does nothing | **remove** | no effect left |
| 126 | `0126_extension_session_disconnect_callback` | 3 | still used | merge | `0017_browser_extension` |
| 127 | `0127_profile_contribution_authority` | 269 | still used | merge | `0002_profiles_accounts`, `0013_contributions` |
| 128 | `0128_notification_activity_state_contract` | 26 | still used | merge | `0016_notifications_email` |
| 129 | `0129_messages_data_authority` | 1274 | still used | merge | `0001_foundation`, `0006_projects_members` |
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
| 140 | `0140_project_workflow_defaults_trigger` | 21 | still used | merge | `0006_projects_members`, `0008_tasks_sprints` |
| 141 | `0141_project_workflow_legacy_presentation_backfill` | 43 | does nothing | **remove** | no effect left |
| 142 | `0142_project_workflow_columns_realtime` | 21 | dropped later | **remove** | everything it made was dropped |
| 143 | `0143_project_guidance_invitations` | 142 | still used | merge | `0006_projects_members` |
| 144 | `0144_project_social_links` | 11 | still used | merge | `0002_profiles_accounts`, `0006_projects_members` |
| 145 | `0145_project_sprint_events` | 16 | still used | merge | `0008_tasks_sprints` |
| 146 | `0146_sprint_activity_history` | 15 | still used | merge | `0008_tasks_sprints` |
| 147 | `0147_foreign_key_leading_indexes` | 23 | still used | merge | `0006_projects_members`, `0008_tasks_sprints` |
| 148 | `0148_sprint_timeline_origin` | 16 | still used | merge | `0008_tasks_sprints` |
| 149 | `0149_sprint_lifecycle_memberships` | 85 | still used | merge | `0008_tasks_sprints` |
| 150 | `0150_task_file_tags` | 2 | still used | merge | `0009_files` |
| 151 | `0151_retire_project_custom_workflow` | 26 | replaced later | **remove** | replaced by a later file |
| 152 | `0125_ponytail_allow_office_mimes` ⚠ dup no. | 26 | one-time data fix | **remove** | one-time data fix, already applied |
| 153 | `0153_task_server_table_lineage` | 46 | still used | merge | `0008_tasks_sprints` |
| 154 | `0154_native_database_security_hardening` | 174 | still used | merge | `0002_profiles_accounts`, `0006_projects_members`, `0008_tasks_sprints`, `0013_contributions` |
| 155 | `0155_account_deletion_privacy` | 30 | cleanup only | **remove** | only drops things |
| 156 | `0156_profile_counter_authority` | 16 | cleanup only | **remove** | only drops things |
| 157 | `0157_storage_realtime_contract_alignment` | 220 | replaced later | **remove** | replaced by a later file |
| 158 | `0158_lifecycle_retention_indexes` | 13 | still used | merge | `0002_profiles_accounts`, `0004_onboarding`, `0017_browser_extension` |
| 159 | `0159_presence_project_members_authorization` | 25 | replaced later | **remove** | replaced by a later file |
| 160 | `0160_realtime_authorization_activation` | 84 | replaced later | **remove** | replaced by a later file |
| 161 | `0161_reviewed_github_sync` | 70 | still used | merge | `0009_files`, `0011_github_imports` |
| 162 | `0162_legal_acceptances` | 35 | still used | merge | `0002_profiles_accounts` |
| 163 | `0163_system_scale_and_index_hardening` | 36 | still used | merge | `0008_tasks_sprints`, `0009_files`, `0012_updates`, `0015_connections`, `0016_notifications_email` |
| 164 | `0164_extension_indexes_and_redis_locks` | 38 | still used | merge | `0009_files`, `0011_github_imports`, `0017_browser_extension` |
| 165 | `0165_messages_performance_and_deadlock_elimination` | 84 | still used | merge | `0001_foundation`, `0002_profiles_accounts` |
| 166 | `0166_project_recent_activity` | 10 | still used | merge | `0006_projects_members` |
| 167 | `0168_realtime_publication_trim` | 7 | grants/rls only | merge | `0008_tasks_sprints`, `0009_files`, `0015_connections` |
| 168 | `0169_index_fixes` | 20 | still used | merge | `0009_files`, `0011_github_imports` |
| 169 | `0170_rls_security` | 15 | still used | merge | `0009_files` |
| 170 | `0171_sql_naming` | 240 | still used | merge | `0001_foundation`, `0003_storage`, `0006_projects_members`, `0010_docs` |
| 171 | `0173_node_events_single_table` | 74 | still used | merge | `0009_files` |
| 172 | `0174_drop_unused` | 54 | cleanup only | **remove** | only drops things |
| 173 | `0175_docs_retired_objects` | 64 | still used | merge | `0010_docs` |
| 174 | `0176_docs_any_slug_removable` | 5 | cleanup only | **remove** | only drops things |
| 175 | `0177_projects_member_file_upload_default` | 4 | still used | merge | `0006_projects_members` |
| 176 | `0178_storage_asset_lifecycle` | 554 | still used | merge | `0002_profiles_accounts`, `0003_storage`, `0006_projects_members`, `0009_files`, `0011_github_imports`, `0012_updates`, `0017_browser_extension` |
| 177 | `0179_live_catalog_storage_release_hardening` | 226 | still used | merge | `0001_foundation`, `0002_profiles_accounts`, `0009_files`, `0011_github_imports`, `0013_contributions` |
| 178 | `0180_chat_rebuild_additive` | 1400 | still used | merge | `0001_foundation`, `0006_projects_members`, `0008_tasks_sprints`, `0014_messaging` |
| 179 | `0181_chat_rebuild_cutover` | 192 | replaced later | **remove** | replaced by a later file |
| 180 | `0182_chat_canvases` | 76 | still used | merge | `0014_messaging` |
| 181 | `0183_chat_typing_topic` | 68 | dropped later | **remove** | everything it made was dropped |
| 182 | `0184_presence_status` | 56 | still used | merge | `0002_profiles_accounts`, `0006_projects_members` |
| 183 | `0185_chat_rename_default_channel` | 41 | still used | merge | `0014_messaging` |
| 184 | `0186_status_emoji` | 47 | still used | merge | `0002_profiles_accounts`, `0006_projects_members` |
| 185 | `0187_chat_reorganize` | 325 | still used | merge | `0014_messaging` |
| 186 | `0188_chat_tab_files` | 6 | still used | merge | `0014_messaging` |
| 187 | `0189_chat_audit_fixes` | 145 | still used | merge | `0014_messaging` |
| 188 | `0190_chat_thread_self_reply` | 107 | replaced later | **remove** | replaced by a later file |
| 189 | `0191_chat_channel_privacy` | 51 | still used | merge | `0014_messaging` |
| 190 | `0192_chat_inbox_mute_rule` | 18 | still used | merge | `0014_messaging` |
| 191 | `0193_chat_round3_counts` | 256 | still used | merge | `0014_messaging` |
| 192 | `0194_chat_link_preview_hidden` | 4 | still used | merge | `0014_messaging` |
| 193 | `0195_discover_feed_indexes` | 23 | still used | merge | `0006_projects_members` |
| 194 | `0196_rls_p0_visibility` | 103 | still used | merge | `0009_files`, `0010_docs`, `0015_connections` |
| 195 | `0197_chat_due_work_leases` | 7 | still used | merge | `0014_messaging` |
| 196 | `0198_account_deletion_phases` | 20 | still used | merge | `0002_profiles_accounts` |
| 197 | `0199_browser_roles_read_only` | 40 | grants/rls only | merge | its grants are written into the owning table's new file |
| 198 | `0200_project_tab_rls` | 130 | still used | merge | `0006_projects_members`, `0008_tasks_sprints`, `0009_files`, `0012_updates` |
| 199 | `0201_tenant_composite_fks` | 88 | still used | merge | `0008_tasks_sprints`, `0009_files`, `0010_docs`, `0012_updates` |
| 200 | `0202_chat_integrity` | 147 | still used | merge | `0014_messaging` |
| 201 | `0203_trigger_metadata_completeness` | 33 | still used | merge | `0006_projects_members`, `0009_files` |
| 202 | `0204_retired_objects_cleanup` | 46 | still used | merge | `0010_docs` |
| 203 | `0205_transactional_email_outbox` | 57 | still used | merge | `0016_notifications_email` |
| 204 | `0206_foreign_key_indexes` | 49 | still used | merge | `0006_projects_members`, `0012_updates`, `0013_contributions`, `0014_messaging`, `0016_notifications_email` |
| 205 | `0207_catalog_parity` | 11 | still used | merge | `0014_messaging` |
| 206 | `0208_native_auth_uid` | 27 | still used | merge | `0013_contributions` |
| 207 | `0209_skill_catalog_1_3_7` | 190 | seed data | merge | `0019_skill_catalog_1_3_7` |
| 208 | `0210_index_cleanup` | 28 | still used | merge | `0012_updates` |
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
| 219 | `0221_project_members_user_role_idx` | 5 | still used | merge | `0006_projects_members` |
| 220 | `0222_email_verified_claim` | 29 | still used | merge | `0016_notifications_email` |
| 221 | `0223_revoke_connection_acceptance_trigger_exec` | 4 | grants/rls only | merge | its grants are written into the owning table's new file |
| 222 | `0224_presence_activity_authority` | 83 | still used | merge | `0001_foundation` |
| 223 | `0225_deleted_projects_own_no_chat` | 104 | still used | merge | `0006_projects_members`, `0014_messaging` |
| 224 | `0226_application_thread_rules` | 318 | still used | merge | `0014_messaging` |
| 225 | `0227_application_lifecycle_constraints` | 41 | still used | merge | `0006_projects_members` |
| 226 | `0228_application_thread_messaging` | 229 | still used | merge | `0006_projects_members`, `0014_messaging` |
| 227 | `0229_drop_application_proposal_columns` | 16 | cleanup only | **remove** | only drops things |
| 228 | `0230_application_update_one_trip` | 40 | replaced later | **remove** | replaced by a later file |
| 229 | `0231_validate_application_message_length` | 14 | does nothing | **remove** | no effect left |
| 230 | `0232_application_thread_guards` | 254 | still used | merge | `0006_projects_members`, `0014_messaging` |
| 231 | `0233_task_completion_policy` | 32 | still used | merge | `0006_projects_members`, `0008_tasks_sprints` |
| 232 | `0234_application_closures` | 22 | still used | merge | `0006_projects_members` |
| 233 | `0235_onboarding_integrity` | 103 | still used | merge | `0002_profiles_accounts`, `0004_onboarding` |
| 234 | `0236_storage_media_contracts` | 60 | one-time data fix | **remove** | one-time data fix, already applied |
| 235 | `0237_profile_contribution_stories` | 53 | still used | merge | `0002_profiles_accounts`, `0013_contributions` |
| 236 | `0238_application_acceptance_security_hardening` | 22 | still used | merge | `0006_projects_members` |
| 237 | `0239_connections_security_and_indexes` | 75 | still used | merge | `0015_connections` |
| 238 | `0240_member_welcome_card_and_channel_joins` | 154 | still used | merge | `0014_messaging` |
| 239 | `0241_organizations_core` | 236 | still used | merge | `0006_projects_members`, `0007_organizations` |
| 240 | `0242_discover_updates_feed_index` | 8 | still used | merge | `0012_updates` |
| 241 | `0243_org_sprints` | 59 | still used | merge | `0008_tasks_sprints`, `0010_docs` |
| 242 | `0244_org_assignments` | 129 | still used | merge | `0008_tasks_sprints`, `0009_files` |
| 243 | `0245_org_updates` | 122 | still used | merge | `0012_updates` |
| 244 | `0246_org_docs` | 31 | still used | merge | `0010_docs` |
| 245 | `0247_org_files` | 95 | still used | merge | `0009_files` |
| 246 | `0248_org_profile` | 8 | still used | merge | `0013_contributions` |
| 247 | `0249_org_chat` | 384 | still used | merge | `0014_messaging` |
| 248 | `0250_org_email` | 17 | still used | merge | `0016_notifications_email` |
| 249 | `0251_org_foreign_key_indexes` | 21 | still used | merge | `0006_projects_members`, `0007_organizations`, `0010_docs` |
| 250 | `0252_role_applications_server_writes` | 9 | cleanup only | **remove** | only drops things |
| 251 | `0253_security_email_kinds` | 13 | replaced later | **remove** | replaced by a later file |
| 252 | `0254_org_trust_lifecycle` | 117 | still used | merge | `0006_projects_members`, `0008_tasks_sprints`, `0012_updates`, `0014_messaging`, `0018_moderation` |
| 253 | `0255_security_email_completed` | 12 | still used | merge | `0016_notifications_email` |
| 254 | `0256_content_reports_reporter_index` | 4 | still used | merge | `0018_moderation` |
| 255 | `0257_unit_leads` | 5 | still used | merge | `0006_projects_members` |
| 256 | `0258_sprint_notify_on_start` | 3 | still used | merge | `0008_tasks_sprints` |
| 257 | `0259_subtask_completed_by` | 4 | still used | merge | `0008_tasks_sprints` |
| 258 | `0260_contribution_work_record` | 3 | still used | merge | `0013_contributions` |
| 259 | `0261_org_chat_defaults` | 105 | still used | merge | `0014_messaging` |
| 260 | `0262_contribution_browser_grants` | 6 | grants/rls only | merge | its grants are written into the owning table's new file |
| 261 | `0263_org_type_other` | 6 | still used | merge | `0006_projects_members` |
