DROP INDEX IF EXISTS public.idx_project_node_locks_expires;
--> statement-breakpoint
ALTER TABLE IF EXISTS public.project_markdowns RENAME TO project_docs;
--> statement-breakpoint
ALTER TABLE IF EXISTS public.project_markdown_versions RENAME TO project_doc_versions;
--> statement-breakpoint
ALTER TABLE IF EXISTS public.project_markdown_assets RENAME TO project_doc_assets;
--> statement-breakpoint
ALTER TABLE IF EXISTS public.project_markdown_draft_contributors RENAME TO project_doc_draft_contributors;
--> statement-breakpoint
DO $rename_types$
BEGIN
  IF to_regtype('public.status_readme_asset') IS NOT NULL AND to_regtype('public.status_doc_asset') IS NULL THEN
    ALTER TYPE public.status_readme_asset RENAME TO status_doc_asset;
  END IF;
  IF to_regtype('public.status_role_app') IS NOT NULL AND to_regtype('public.status_role_application') IS NULL THEN
    ALTER TYPE public.status_role_app RENAME TO status_role_application;
  END IF;
END
$rename_types$;
--> statement-breakpoint
DO $rename_functions$
BEGIN
  IF to_regprocedure('app_private.nb_project_public_readme_visible(uuid)') IS NOT NULL THEN
    ALTER FUNCTION app_private.nb_project_public_readme_visible(uuid) RENAME TO nb_project_public_doc_visible;
  END IF;
  IF to_regprocedure('app_private.nb_readme_version_is_public(uuid)') IS NOT NULL THEN
    ALTER FUNCTION app_private.nb_readme_version_is_public(uuid) RENAME TO nb_doc_version_is_public;
  END IF;
  IF to_regprocedure('app_private.nb_readme_asset_is_public(uuid)') IS NOT NULL THEN
    ALTER FUNCTION app_private.nb_readme_asset_is_public(uuid) RENAME TO nb_doc_asset_is_public;
  END IF;
  IF to_regprocedure('public.prevent_readme_delete()') IS NOT NULL THEN
    ALTER FUNCTION public.prevent_readme_delete() RENAME TO prevent_primary_doc_delete;
  END IF;
END
$rename_functions$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_doc_versions v
    JOIN public.project_docs m
      ON m.id = v.markdown_id
     AND m.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(m.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_project_public_doc_visible(v.project_id)
  );
$$;
--> statement-breakpoint
DO $doc_asset_fn$
BEGIN
  IF to_regclass('public.project_doc_assets') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION app_private.nb_doc_asset_is_public(p_asset_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE SECURITY DEFINER
      SET search_path = ''
      AS $body$
        SELECT EXISTS (
          SELECT 1
          FROM public.project_doc_assets a
          JOIN public.project_docs m ON m.id = a.markdown_id
          WHERE a.id = p_asset_id
            AND a.deleted_at IS NULL
            AND a.status = 'published'
            AND COALESCE(m.settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
            AND app_private.nb_project_public_doc_visible(a.project_id)
            AND (a.version_id IS NULL OR app_private.nb_doc_version_is_public(a.version_id))
        );
      $body$
    $fn$;
  END IF;
END
$doc_asset_fn$;
--> statement-breakpoint
DO $rename_triggers$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('trg_messages_after_insert_consistency', 'messages', 'messages_insert_consistency'),
      ('trigger_sync_project_open_roles_count', 'project_open_roles', 'project_open_roles_sync_count'),
      ('tr_sync_profile_to_auth_user_metadata', 'profiles', 'profiles_sync_auth_metadata'),
      ('trg_prevent_readme_delete', 'project_docs', 'project_docs_prevent_delete')
    ) AS t(old_name, table_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgname = r.old_name AND tgrelid = to_regclass('public.' || r.table_name)
    ) THEN
      EXECUTE format('ALTER TRIGGER %I ON public.%I RENAME TO %I', r.old_name, r.table_name, r.new_name);
    END IF;
  END LOOP;
END
$rename_triggers$;
--> statement-breakpoint
DO $rename_indexes$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('collection_projects_collection_id_project_id_pk', 'collection_projects_collection_id_project_id_pkey'),
    ('connection_suggestion_dismissals_user_profile_uidx', 'connection_suggestion_dismissals_user_profile_unique'),
    ('connection_suggestions_user_suggested_uidx', 'connection_suggestions_user_suggested_unique'),
    ('connections_active_pair_uidx', 'connections_active_pair_unique'),
    ('conversation_participants_last_reaction_message_conversation_id', 'conversation_participants_last_reaction_message_idx'),
    ('extension_device_sessions_token_hash_key', 'extension_device_sessions_token_hash_unique'),
    ('extension_recovery_drafts_storage_key_key', 'extension_recovery_drafts_storage_key_unique'),
    ('github_contributor_identity_uidx', 'github_contributor_identity_unique'),
    ('idx_connections_status', 'connections_status_idx'),
    ('idx_onboarding_events_user_id', 'onboarding_events_user_id_idx'),
    ('idx_onboarding_submissions_user_id', 'onboarding_submissions_user_id_idx'),
    ('idx_profile_audit_events_user_id', 'profile_audit_events_user_id_idx'),
    ('idx_project_file_index_project_id', 'project_file_index_project_id_idx'),
    ('idx_project_follows_project_id', 'project_follows_project_id_idx'),
    ('idx_project_follows_user_id', 'project_follows_user_id_idx'),
    ('idx_project_members_project', 'project_members_project_idx'),
    ('idx_project_members_user', 'project_members_user_idx'),
    ('idx_project_node_events_actor_id', 'project_node_events_actor_id_idx'),
    ('idx_project_node_events_node_id', 'project_node_events_node_id_idx'),
    ('idx_project_node_events_project_id', 'project_node_events_project_id_idx'),
    ('idx_project_node_locks_locked_by', 'project_node_locks_locked_by_idx'),
    ('idx_project_node_locks_project_id', 'project_node_locks_project_id_idx'),
    ('idx_project_nodes_created_by', 'project_nodes_created_by_idx'),
    ('idx_project_nodes_deleted_by', 'project_nodes_deleted_by_idx'),
    ('idx_project_nodes_parent_id', 'project_nodes_parent_id_idx'),
    ('idx_project_nodes_project_id', 'project_nodes_project_id_idx'),
    ('idx_project_nodes_root_covering', 'project_nodes_root_covering_idx'),
    ('idx_projects_owner', 'projects_owner_idx'),
    ('idx_projects_status', 'projects_status_idx'),
    ('idx_recovery_drafts_path_time', 'extension_recovery_drafts_path_time_idx'),
    ('idx_recovery_sessions_user_device', 'extension_recovery_sessions_user_device_idx'),
    ('idx_role_applications_applicant_id', 'role_applications_applicant_id_idx'),
    ('idx_role_applications_decision_by', 'role_applications_decision_by_idx'),
    ('idx_role_applications_project_id', 'role_applications_project_id_idx'),
    ('idx_role_applications_role_id', 'role_applications_role_id_idx'),
    ('idx_saved_projects_project_id', 'saved_projects_project_id_idx'),
    ('idx_saved_projects_user_id', 'saved_projects_user_id_idx'),
    ('idx_task_comment_likes_comment_id', 'task_comment_likes_comment_id_idx'),
    ('idx_task_comment_likes_user_id', 'task_comment_likes_user_id_idx'),
    ('idx_task_comments_created_at', 'task_comments_created_at_idx'),
    ('idx_task_comments_deleted_by', 'task_comments_deleted_by_idx'),
    ('idx_task_comments_parent_created_at', 'task_comments_parent_created_at_idx'),
    ('idx_task_comments_parent_id', 'task_comments_parent_id_idx'),
    ('idx_task_comments_task_id', 'task_comments_task_id_idx'),
    ('idx_task_comments_user_id', 'task_comments_user_id_idx'),
    ('idx_task_node_links_created_by', 'task_node_links_created_by_idx'),
    ('idx_task_node_links_node_id', 'task_node_links_node_id_idx'),
    ('idx_task_node_links_task_id', 'task_node_links_task_id_idx'),
    ('idx_task_read_receipts_user_task', 'task_read_receipts_user_task_idx'),
    ('idx_task_subtasks_position', 'task_subtasks_position_idx'),
    ('idx_task_subtasks_task_completed', 'task_subtasks_task_completed_idx'),
    ('idx_task_subtasks_task_id', 'task_subtasks_task_id_idx'),
    ('idx_tasks_creator_id', 'tasks_creator_id_idx'),
    ('idx_tasks_sprint_id', 'tasks_sprint_id_idx'),
    ('onboarding_submissions_user_key_uidx', 'onboarding_submissions_user_key_unique'),
    ('project_git_deltas_unique_seq', 'project_git_deltas_seq_unique'),
    ('project_node_events_id_created_at_pk', 'project_node_events_id_created_at_pkey'),
    ('project_node_locks_lease_uidx', 'project_node_locks_lease_unique'),
    ('project_nodes_active_parent_name_uidx', 'project_nodes_active_parent_name_unique'),
    ('project_nodes_active_project_path_uidx', 'project_nodes_active_project_path_unique'),
    ('project_update_drafts_project_id_user_id_pk', 'project_update_drafts_project_id_user_id_pkey'),
    ('recovery_code_redemptions_user_code_uidx', 'recovery_code_redemptions_user_code_unique'),
    ('upload_intents_bucket_key_uidx', 'upload_intents_bucket_key_unique')
    ) AS t(old_name, new_name)
  LOOP
    IF to_regclass('public.' || quote_ident(r.old_name)) IS NOT NULL
      AND to_regclass('public.' || quote_ident(r.new_name)) IS NULL THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
  FOR r IN
    SELECT i.relname AS old_name,
      regexp_replace(regexp_replace(i.relname, '^project_(readme|markdown)s_', 'project_docs_'), '^project_(readme|markdown)_', 'project_doc_') AS new_name
    FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('project_docs', 'project_doc_versions', 'project_doc_assets', 'project_doc_draft_contributors')
      AND i.relname ~ '^project_(readme|markdown)'
  LOOP
    IF to_regclass('public.' || quote_ident(r.new_name)) IS NULL THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
END
$rename_indexes$;
--> statement-breakpoint
DO $rename_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH p AS (
      SELECT tablename, policyname, lower(cmd) AS command, coalesce(qual, with_check, '') AS e
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
    ), named AS (
      SELECT tablename, policyname,
        tablename || '_' || command || '_' || CASE
          WHEN e ~ 'nb_project_can_admin' AND e !~ 'auth\.uid|get_auth_uid' THEN 'project_admin'
          WHEN e ~ 'nb_project_can_admin' THEN 'actor_or_project_admin'
          WHEN e ~ 'nb_project_can_write' THEN 'project_writer'
          WHEN e ~ 'nb_is_conversation_participant' THEN 'participant'
          WHEN e ~ 'nb_collection_can_manage' THEN 'collection_owner'
          WHEN e ~ '(author_id|user_id) = \( SELECT auth\.uid\(\) AS uid\)\) OR \(EXISTS' THEN 'author_or_project_admin'
          WHEN e ~ 'visibility|nb_project_can_read|nb_doc_|nb_readme_' OR e = 'true' OR e !~ 'auth\.uid|get_auth_uid' THEN 'visible'
          WHEN e !~ 'EXISTS' THEN 'own'
          ELSE 'project_member'
        END AS new_name
      FROM p
    )
    SELECT tablename, policyname, new_name
    FROM (
      SELECT *, count(*) OVER (PARTITION BY tablename, new_name) AS dupes FROM named
    ) ranked
    WHERE dupes = 1 AND policyname <> new_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = r.tablename AND policyname = r.new_name
    ) THEN
      EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', r.policyname, r.tablename, r.new_name);
    END IF;
  END LOOP;
END
$rename_policies$;
