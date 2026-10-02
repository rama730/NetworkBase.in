# Storage plan validation: reproducible evidence

Date: 30 September 2026. All connected-database inspection in this review was read-only. No application code, database rows, storage objects, policies or deployed settings were changed. This directory and the replacement plan are documentation artifacts.

## Read the outcome

[Complete replacement implementation plan](../../superpowers/plans/2026-09-30-application-storage-redesign.md)

The plan contains 65 current findings, 12 implementation phases and 33 acceptance groups. [The historical ledger](historical-findings.md) carries all 209 IDs from the earlier SQL/Supabase audit without treating their historical status as current proof. [Coverage](coverage.md) lists the initial source folders and SQL files; [inventory.json](inventory.json) includes hashes and exact regex-hit lines. [The concurrent-change inventory](concurrent-delta.json) extends that snapshot through its explicit review cutoff: 999 source files (excluding an editor temporary file) and 175 SQL files / 58,075 SQL lines.

## Most consequential new evidence

| Observation | Evidence | Plan disposition |
|---|---|---|
| Intent verification can be bypassed through own-row mutation | Live `upload_intents_insert_own` and `upload_intents_update_own` require only `auth.uid() = user_id`; authenticated role has INSERT/UPDATE; finalizer returns early for `finalized` | F52, P02, T26 |
| SQL and application read/write scope differ | Live `project_nodes_select_visible` and `file_versions_select_visible` contain public/member branches without full task/tab/deletion predicates; node/version write policies do not enforce application revision lifecycle | F53, P02, T26/T27 |
| Missing initial/current versions | 9,774 active nodes have a non-null key; 5,859 have no version; same 5,859 lack current-version row | F58, P02/P09, T27/T29 |
| Reference lookup index missing | Live `file_versions` indexes cover ID, node/version, hash, uploader and node/upload time; no `s3_key` index | F54, P02, T28 |
| Hash-only maintenance creates a contribution | Trigger skips UPDATE only when old/new hash is not distinct (plus its key guard); NULL→hash falls through to project sequence/event insertion | F55/F56/F60, P02/P09/P11, T29 |
| Legacy CLI targets removed schema | `to_regclass('public.task_files')` returns null; `project_nodes.path` is NOT NULL; script still selects task_files and omits path on folder insert | F59, P01/P09, T30 |
| Private update-media delivery can be bypassed | Live `project-updates-media` bucket is public | F19, P02/P06, T09/T13 |
| Release evidence is incomplete | Journal check passes; governance fails on existing 0176 manifest omission; runtime-role checker fails before SQL | F61, P01/P02, T31 |

These observations are from code/catalog inspection. No adversarial mutation or exploit was run against the connected project. A direct API behavioral matrix belongs in isolated integration testing.

## Source anchors

- [Intent overwrite/reset](../../../src/lib/upload/upload-intents.ts:74), [finalized early return](../../../src/lib/upload/upload-intents.ts:224), [Range response buffering](../../../src/lib/upload/upload-intents.ts:250), [batch map without bucket](../../../src/lib/upload/upload-intents.ts:312).
- [Contribution trigger](../../../drizzle/0161_reviewed_github_sync.sql:46) and [project sequence update](../../../drizzle/0161_reviewed_github_sync.sql:60). Live function definition was also inspected; later deployed changes must be reconciled before migration.
- [Hash body buffering](../../../scripts/backfill-file-hashes.ts:69), [update without original-key comparison](../../../scripts/backfill-file-hashes.ts:98), [partial-failure exit behavior](../../../scripts/backfill-file-hashes.ts:124).
- [Legacy insert without materialized path](../../../scripts/migrate-task-files-to-project-files.ts:101), [upsert copy](../../../scripts/migrate-task-files-to-project-files.ts:166), [obsolete source table](../../../scripts/migrate-task-files-to-project-files.ts:193), [lock after copy](../../../scripts/migrate-task-files-to-project-files.ts:259).
- [Extension cleanup of supplied key](../../../src/app/api/v1/extension/file/route.ts:351).
- [Update-media signed redirect](../../../src/app/api/v1/projects/[id]/update-media/route.ts:59).

Paths/line numbers refer to the reviewed working-tree snapshot. File hashes in the inventory detect subsequent changes.

## Read-only SQL used for the new integrity check

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
SELECT
  count(*) FILTER (
    WHERE n.deleted_at IS NULL AND n.s3_key IS NOT NULL
  ) AS active_stored_nodes,
  count(*) FILTER (
    WHERE n.deleted_at IS NULL AND n.s3_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.file_versions v WHERE v.node_id = n.id
      )
  ) AS active_stored_without_any_version,
  count(*) FILTER (
    WHERE n.deleted_at IS NULL AND n.s3_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.file_versions v
        WHERE v.node_id = n.id AND v.version = n.current_version
      )
  ) AS active_stored_without_current_version
FROM public.project_nodes n;
COMMIT;
```

Result: `9774 / 5859 / 5859`. Non-null key does not establish object existence. This is a repair population, not permission to write placeholder versions blindly.

Catalog queries used `pg_policies`, `pg_indexes`, `information_schema.role_table_grants`, `information_schema.columns`, table/trigger/FK catalogs and `storage.buckets`. The account's connector role is not proof of the application's deployed runtime role.

## Verification results and limitations

- Focused baseline: **37 passed, 0 failed, 0 skipped**. The exact command is in the plan.
- `node --import tsx scripts/check-migration-journal.ts`: passed.
- `node --import tsx scripts/check-sql-governance.ts`: initially failed on existing `0176_docs_any_slug_removable.sql`. The final rerun additionally flagged concurrent `0177_projects_member_file_upload_default.sql`; journal length 175 vs manifest 173. Neither owning change was modified by this review.
- The ordinary `tsx` CLI launcher encountered an IPC socket permission error. The Node import-loader invocation successfully ran journal and governance checks.
- `node --import tsx scripts/check-runtime-database-role.ts`: failed at compilation because top-level await is unsupported with its CommonJS output mode. No role verdict was obtained.
- Plan consistency: all F01–F65 IDs exist exactly once in the finding register, each has a phase/test mapping; P01–P12 and T01–T33 exist; all plan relative document links resolve; all 209 historical IDs are carried forward.
- No full build, disposable migration replay, authenticated Data API attack simulation, load test, network fault campaign, backup copy or restore drill was performed. Their absence is explicit in the acceptance plan.

## Evidence interpretation

Source-contract tests can pass while a live RLS policy or a cross-route lifecycle still fails. Advisor warnings are not an exhaustive security audit. A small live database cannot prove the target query plans. Full-text matching finds candidates but does not prove every indirect dependency or line has been manually reviewed. The implementation gates require actual behavior, catalog parity, and measured capacity.

The shared checkout advanced during the review. The delta review covered the new project-picture upload helper, launch settings/member-upload default, its schema/migration, and person-card rendering. The replacement plan includes their consequences. The 37-test baseline precedes those concurrent changes; it is not a green verdict for the later checkout. Later edits beyond the recorded cutoff require another delta review.

## Implementation and connected-data evidence — 2 October 2026

The historical observations above remain the audit baseline. The following later work changed the connected database and storage metadata:

- Applied migrations 0178 and 0179 transactionally and requested a PostgREST schema reload.
- Live lineage passed with 177 canonical tags and 7 legacy aliases. Live catalog drift, project-update schema and cross-project hardening checks passed.
- Repaired all 5,859 active nodes that lacked their current version. Full streamed verification and SHA-256 registration now leave zero missing or incomplete current versions.
- Registered all recoverable retained legacy references. The final audit reports zero project covers, update-media items, committed chat uploads, message attachments or managed avatars without a lifecycle asset.
- Sanitized and published three legacy managed avatars through immutable public WebP derivatives.
- Repaired three current file/version key disagreements after verifying the authoritative node-key bytes. The follow-up dry run has zero candidates.
- Reconciled three user quota scopes and five project quota scopes; no scope exceeded its limit.
- Preserved unrecoverable evidence without fabricating bytes: 14 historical file revisions and 2,264 Git sync snapshots refer to mutable keys whose current bytes differ from their recorded history; eight chat references point to provider objects that no longer exist. These rows have explicit non-retryable quarantine records, and missing chat references point to `missing` lifecycle assets.
- The exact update-media key reported in the runtime error is attached to a verified asset. `storage_assets`, `project_update_media_assets` and `project_nodes.asset_id` all exist in the live catalog.
- The Redis cache path now treats provider timeout as a cache miss/write failure and does not abort page rendering. Discover, project docs and project files were exercised in the browser without the reported runtime overlays or missing-column errors.
- The final production build, full-repository lint, TypeScript check and API envelope scan all pass after the private-read integrity changes. The envelope scan covers 83 route files, and the related private file/chat/document regression set passes 93 of 93 tests.

Final connected audit summary: 9,801 verified assets; zero missing current-version rows; zero incomplete current-version rows; zero unattached current media/chat/avatar references.

The runtime-role check still fails because `DATABASE_URL` authenticates as the `postgres` superuser. A safe correction requires a least-privilege application/worker role plus request-scoped database authorization; changing only the checker or role name would not satisfy the security requirement. A disposable replay database, independent backup infrastructure, restore proof and the one-million-user qualification workload are also still external release gates.
