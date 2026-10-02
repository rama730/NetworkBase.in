-- Close catalog drift discovered during the storage release audit. These
-- statements are idempotent so production-shaped upgrades and replay use the
-- same authority.
DO $realtime_task_comment_likes$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'task_comment_likes'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comment_likes;
  END IF;
END
$realtime_task_comment_likes$;
--> statement-breakpoint

-- These reviewed GitHub-sync and legal tables are server-owned. RLS without a
-- browser policy is deliberate and fails closed.
ALTER TABLE public.github_contributor_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON
  public.github_contributor_identities,
  public.github_sync_connections,
  public.github_sync_files,
  public.github_sync_runs,
  public.legal_acceptances
FROM anon, authenticated;
--> statement-breakpoint

-- Keep one permissive SELECT policy per contribution projection. Older policy
-- names are removed by catalog identity so renamed historical policies cannot
-- widen the combined result.
DO $contribution_policy_cleanup$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT c.relname AS table_name, p.polname AS policy_name
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('profile_project_contributions', 'profile_project_contribution_stages')
      AND p.polcmd = 'r'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policy_name, policy_row.table_name);
  END LOOP;
END
$contribution_policy_cleanup$;

CREATE POLICY profile_contributions_read_authorized
ON public.profile_project_contributions FOR SELECT
USING (
  profile_id = (SELECT app_private.get_auth_uid())
  OR (
    visibility = 'public'
    AND deleted_at IS NULL
    AND (
      (project_id IS NULL AND external_key IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.id = profile_project_contributions.project_id
          AND project.deleted_at IS NULL
          AND project.visibility IN ('public', 'unlisted')
          AND project.status <> 'draft'
      )
    )
  )
);

CREATE POLICY profile_contribution_stages_read_authorized
ON public.profile_project_contribution_stages FOR SELECT
USING (
  profile_id = (SELECT app_private.get_auth_uid())
  OR EXISTS (
    SELECT 1
    FROM public.profile_project_contributions contribution
    LEFT JOIN public.projects project ON project.id = contribution.project_id
    WHERE contribution.id = profile_project_contribution_stages.contribution_id
      AND contribution.deleted_at IS NULL
      AND contribution.visibility = 'public'
      AND (
        (contribution.project_id IS NULL AND contribution.external_key IS NOT NULL)
        OR (
          project.deleted_at IS NULL
          AND project.visibility IN ('public', 'unlisted')
          AND project.status <> 'draft'
        )
      )
  )
);
--> statement-breakpoint

DO $dm_pair_authority$
DECLARE
  existing_index_compatible boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.dm_pairs'::regclass
      AND conname = 'dm_pairs_user_low_high_unique'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.dm_pairs
      GROUP BY user_low, user_high
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'dm_pairs contains duplicate user pairs; quarantine them before applying the unique authority';
    END IF;
    IF to_regclass('public.dm_pairs_user_low_high_unique') IS NOT NULL THEN
      SELECT
        index_state.indisunique
        AND index_state.indisvalid
        AND index_state.indpred IS NULL
        AND index_state.indexprs IS NULL
        AND ARRAY(
          SELECT attribute.attname
          FROM unnest(index_state.indkey) WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_catalog.pg_attribute attribute
            ON attribute.attrelid = index_state.indrelid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        ) = ARRAY['user_low', 'user_high']::name[]
      INTO existing_index_compatible
      FROM pg_catalog.pg_index index_state
      WHERE index_state.indexrelid = 'public.dm_pairs_user_low_high_unique'::regclass;

      IF NOT COALESCE(existing_index_compatible, false) THEN
        RAISE EXCEPTION 'dm_pairs_user_low_high_unique exists but is not a valid unqualified unique index on (user_low, user_high)';
      END IF;

      ALTER TABLE public.dm_pairs
        ADD CONSTRAINT dm_pairs_user_low_high_unique
        UNIQUE USING INDEX dm_pairs_user_low_high_unique;
    ELSE
      ALTER TABLE public.dm_pairs
        ADD CONSTRAINT dm_pairs_user_low_high_unique UNIQUE (user_low, user_high);
    END IF;
  END IF;
END
$dm_pair_authority$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.handle_message_insert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preview_text text;
  preview_type text;
  zero_uuid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  preview_text := CASE
    WHEN jsonb_typeof(NEW.metadata -> 'structured') = 'object' THEN COALESCE(
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,summary}', ''), '\s+', ' ', 'g'), 160), ''),
      NULLIF(left(regexp_replace(COALESCE(NEW.metadata #>> '{structured,title}', ''), '\s+', ' ', 'g'), 160), ''),
      'Workflow update'
    )
    WHEN NULLIF(btrim(COALESCE(NEW.content, '')), '') IS NOT NULL
      THEN left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160)
    WHEN NEW.type = 'image' THEN 'Photo'
    WHEN NEW.type = 'video' THEN 'Video'
    WHEN NEW.type = 'file' THEN 'Attachment'
    WHEN NEW.type = 'system' THEN 'System update'
    ELSE 'Message'
  END;
  preview_type := COALESCE(NULLIF(NEW.metadata #>> '{structured,kind}', ''), NEW.type, 'text');

  UPDATE public.conversations
  SET updated_at = GREATEST(updated_at, NEW.created_at)
  WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
  SET
    unread_count = unread_count + CASE
      WHEN last_read_at IS NULL
        OR (NEW.created_at, NEW.id) > (last_read_at, COALESCE(last_read_message_id, zero_uuid))
      THEN 1 ELSE 0 END,
    last_message_at = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.created_at ELSE last_message_at END,
    last_message_id = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.id ELSE last_message_id END,
    last_message_preview = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN preview_text ELSE last_message_preview END,
    last_message_type = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN preview_type ELSE last_message_type END,
    last_message_sender_id = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.sender_id ELSE last_message_sender_id END,
    archived_at = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NULL ELSE archived_at END
  WHERE conversation_id = NEW.conversation_id
    AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id);

  IF NEW.sender_id IS NOT NULL THEN
    UPDATE public.conversation_participants
    SET
      unread_count = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) >= (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN 0 ELSE unread_count END,
      last_read_at = CASE WHEN last_read_at IS NULL OR (NEW.created_at, NEW.id) > (last_read_at, COALESCE(last_read_message_id, zero_uuid)) THEN NEW.created_at ELSE last_read_at END,
      last_read_message_id = CASE WHEN last_read_at IS NULL OR (NEW.created_at, NEW.id) > (last_read_at, COALESCE(last_read_message_id, zero_uuid)) THEN NEW.id ELSE last_read_message_id END,
      last_message_at = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.created_at ELSE last_message_at END,
      last_message_id = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.id ELSE last_message_id END,
      last_message_preview = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN preview_text ELSE last_message_preview END,
      last_message_type = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN preview_type ELSE last_message_type END,
      last_message_sender_id = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NEW.sender_id ELSE last_message_sender_id END,
      archived_at = CASE WHEN last_message_at IS NULL OR (NEW.created_at, NEW.id) > (last_message_at, COALESCE(last_message_id, zero_uuid)) THEN NULL ELSE archived_at END
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_message_insert_consistency() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

DO $profile_auth_metadata_function$
BEGIN
  IF to_regprocedure('public.sync_profile_to_auth_user_metadata()') IS NOT NULL THEN
    ALTER FUNCTION public.sync_profile_to_auth_user_metadata() SET search_path = '';
    REVOKE ALL ON FUNCTION public.sync_profile_to_auth_user_metadata() FROM PUBLIC, anon, authenticated;
  END IF;
END
$profile_auth_metadata_function$;
