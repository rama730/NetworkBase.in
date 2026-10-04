-- Canonical server-owned storage lifecycle. Existing domain tables continue to
-- own authorization while assets own byte verification, deletion, and backup.
CREATE TABLE IF NOT EXISTS public.storage_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Durable scope identity must survive profile/project cascades.
  owner_user_id uuid,
  project_id uuid,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  declared_mime_type text NOT NULL,
  declared_size bigint NOT NULL,
  verified_mime_type text,
  verified_size bigint,
  content_hash text,
  source_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL,
  idempotency_key text,
  request_fingerprint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  quota_tracked boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  verification_lease_token uuid,
  verification_lease_expires_at timestamptz,
  verification_fence bigint NOT NULL DEFAULT 0,
  delete_after timestamptz,
  deletion_lease_token uuid,
  deletion_lease_expires_at timestamptz,
  deletion_fence bigint NOT NULL DEFAULT 0,
  backup_state text NOT NULL DEFAULT 'not_required',
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_assets_state_check CHECK (
    state IN ('pending', 'verified', 'delete_pending', 'deleting', 'deleted', 'missing')
  ),
  CONSTRAINT storage_assets_backup_state_check CHECK (
    backup_state IN ('not_required', 'pending', 'verified')
  ),
  CONSTRAINT storage_assets_declared_size_check CHECK (declared_size >= 0),
  CONSTRAINT storage_assets_verified_size_check CHECK (verified_size IS NULL OR verified_size >= 0),
  CONSTRAINT storage_assets_verification_fence_check CHECK (verification_fence >= 0),
  CONSTRAINT storage_assets_deletion_fence_check CHECK (deletion_fence >= 0),
  CONSTRAINT storage_assets_verified_fields_check CHECK (
    state <> 'verified'
    OR (verified_at IS NOT NULL AND verified_size IS NOT NULL AND verified_mime_type IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS storage_assets_bucket_key_unique
  ON public.storage_assets(bucket, storage_key);
CREATE UNIQUE INDEX IF NOT EXISTS storage_assets_owner_purpose_idempotency_unique
  ON public.storage_assets(owner_user_id, purpose, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storage_assets_state_expiry_idx
  ON public.storage_assets(state, expires_at, id);
CREATE INDEX IF NOT EXISTS storage_assets_verification_lease_idx
  ON public.storage_assets(state, verification_lease_expires_at, id)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS storage_assets_verification_work_idx
  ON public.storage_assets(verification_lease_expires_at, updated_at, id)
  WHERE state = 'pending' AND (verification_lease_token IS NOT NULL OR last_error_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS storage_assets_backup_due_idx
  ON public.storage_assets(verified_at, id)
  WHERE backup_state = 'pending' AND state IN ('verified', 'delete_pending');
CREATE INDEX IF NOT EXISTS storage_assets_deletion_due_idx
  ON public.storage_assets(delete_after, id)
  WHERE state = 'delete_pending';
CREATE INDEX IF NOT EXISTS storage_assets_owner_idx
  ON public.storage_assets(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS storage_assets_project_idx
  ON public.storage_assets(project_id, created_at);
CREATE INDEX IF NOT EXISTS storage_assets_source_idx
  ON public.storage_assets(source_asset_id);
ALTER TABLE public.storage_assets
  ADD COLUMN IF NOT EXISTS quota_tracked boolean NOT NULL DEFAULT true;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.storage_asset_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operation text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  result jsonb,
  error_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT storage_asset_operations_operation_check CHECK (
    operation IN ('upload', 'verify', 'publish', 'delete', 'backup')
  ),
  CONSTRAINT storage_asset_operations_state_check CHECK (
    state IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS storage_asset_operations_owner_idempotency_unique
  ON public.storage_asset_operations(owner_user_id, idempotency_key)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storage_asset_operations_asset_state_idx
  ON public.storage_asset_operations(asset_id, state);
CREATE INDEX IF NOT EXISTS storage_asset_operations_lease_idx
  ON public.storage_asset_operations(state, lease_expires_at, id)
  WHERE state IN ('pending', 'running');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.storage_quota_scopes (
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'project')),
  scope_id uuid NOT NULL,
  limit_bytes bigint NOT NULL CHECK (limit_bytes > 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  retained_bytes bigint NOT NULL DEFAULT 0 CHECK (retained_bytes >= 0),
  outstanding_uploads integer NOT NULL DEFAULT 0 CHECK (outstanding_uploads >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS storage_quota_scopes_outstanding_idx
  ON public.storage_quota_scopes(outstanding_uploads, updated_at);
ALTER TABLE public.storage_quota_scopes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.storage_asset_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('export')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_asset_pins_operation_asset_unique
  ON public.storage_asset_pins(operation_id, asset_id);
CREATE INDEX IF NOT EXISTS storage_asset_pins_asset_expiry_idx
  ON public.storage_asset_pins(asset_id, expires_at);
CREATE INDEX IF NOT EXISTS storage_asset_pins_expiry_idx
  ON public.storage_asset_pins(expires_at, id);
ALTER TABLE public.storage_asset_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.storage_legacy_cleanup_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('project_update_media', 'project_update_draft_media')),
  source_id uuid NOT NULL,
  source_project_id uuid,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'deleting', 'retry', 'deleted')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_legacy_cleanup_source_object_unique
  ON public.storage_legacy_cleanup_targets(source_type, source_id, source_project_id, bucket, storage_key);
CREATE INDEX IF NOT EXISTS storage_legacy_cleanup_due_idx
  ON public.storage_legacy_cleanup_targets(state, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS storage_legacy_cleanup_lease_idx
  ON public.storage_legacy_cleanup_targets(state, lease_expires_at, id);
ALTER TABLE public.storage_legacy_cleanup_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.storage_repair_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_kind text NOT NULL,
  subject_id text NOT NULL,
  error_code text NOT NULL,
  detail text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  next_retry_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_repair_failures_subject_unique
  ON public.storage_repair_failures(repair_kind, subject_id);
CREATE INDEX IF NOT EXISTS storage_repair_failures_due_idx
  ON public.storage_repair_failures(repair_kind, resolved_at, next_retry_at, id);
CREATE INDEX IF NOT EXISTS storage_repair_failures_unresolved_due_idx
  ON public.storage_repair_failures(next_retry_at, created_at, id)
  WHERE resolved_at IS NULL;
ALTER TABLE public.storage_repair_failures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE public.upload_intents
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS upload_intents_asset_unique
  ON public.upload_intents(asset_id)
  WHERE asset_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE public.attachment_uploads
  ADD COLUMN IF NOT EXISTS upload_intent_id uuid REFERENCES public.upload_intents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attachment_uploads_upload_intent_unique
  ON public.attachment_uploads(upload_intent_id)
  WHERE upload_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachment_uploads_asset_idx
  ON public.attachment_uploads(asset_id);

ALTER TABLE public.message_attachments
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS message_attachments_asset_idx
  ON public.message_attachments(asset_id);
--> statement-breakpoint

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS banner_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS profiles_avatar_asset_idx ON public.profiles(avatar_asset_id);
CREATE INDEX IF NOT EXISTS profiles_banner_asset_idx ON public.profiles(banner_asset_id);
--> statement-breakpoint

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cover_image_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_cover_image_asset_idx ON public.projects(cover_image_asset_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_update_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id uuid NOT NULL REFERENCES public.project_updates(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_update_media_assets_update_ordinal_unique
  ON public.project_update_media_assets(update_id, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS project_update_media_assets_update_asset_unique
  ON public.project_update_media_assets(update_id, asset_id);
CREATE INDEX IF NOT EXISTS project_update_media_assets_asset_idx
  ON public.project_update_media_assets(asset_id);
ALTER TABLE public.project_update_media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_update_draft_media_assets (
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, asset_id),
  FOREIGN KEY (project_id, user_id)
    REFERENCES public.project_update_drafts(project_id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS project_update_draft_media_assets_ordinal_unique
  ON public.project_update_draft_media_assets(project_id, user_id, ordinal);
CREATE INDEX IF NOT EXISTS project_update_draft_media_assets_asset_idx
  ON public.project_update_draft_media_assets(asset_id);
ALTER TABLE public.project_update_draft_media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE public.project_nodes
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_nodes_asset_idx ON public.project_nodes(asset_id);

ALTER TABLE public.file_versions
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS file_versions_asset_idx ON public.file_versions(asset_id);
--> statement-breakpoint

ALTER TABLE public.extension_recovery_drafts
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS extension_recovery_drafts_asset_unique
  ON public.extension_recovery_drafts(asset_id)
  WHERE asset_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS manifest_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS manifest_upload_intent_id uuid REFERENCES public.upload_intents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_manifest_asset_unique
  ON public.import_jobs(manifest_asset_id)
  WHERE manifest_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS import_jobs_manifest_intent_idx
  ON public.import_jobs(manifest_upload_intent_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.github_sync_snapshot_assets (
  run_id uuid NOT NULL REFERENCES public.github_sync_runs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id) ON DELETE RESTRICT,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, asset_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS github_sync_snapshot_assets_run_path_unique
  ON public.github_sync_snapshot_assets(run_id, path);
CREATE INDEX IF NOT EXISTS github_sync_snapshot_assets_asset_idx
  ON public.github_sync_snapshot_assets(asset_id);
ALTER TABLE public.github_sync_snapshot_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS file_versions_s3_key_idx
  ON public.file_versions(s3_key)
  WHERE s3_key <> '';
CREATE INDEX IF NOT EXISTS project_nodes_file_s3_key_idx
  ON public.project_nodes(s3_key)
  WHERE type = 'file' AND s3_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_participants_user_conversation_idx
  ON public.conversation_participants(user_id, conversation_id);
--> statement-breakpoint

-- Bucket visibility is part of the authorization contract. Private content is
-- delivered only through the application routes above; browser transfers use
-- server-issued signed upload capabilities, so broad storage.objects policies
-- are unnecessary.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-image-staging',
  'profile-image-staging',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

UPDATE storage.buckets SET
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
WHERE id = 'project-updates-media';

UPDATE storage.buckets SET public = false, file_size_limit = 52428800
WHERE id = 'chat-attachments';
UPDATE storage.buckets SET public = false, file_size_limit = 10485760
WHERE id IN ('project-files', 'extension-recovery-drafts');

DROP POLICY IF EXISTS project_files_read ON storage.objects;
DROP POLICY IF EXISTS project_files_public_read ON storage.objects;
DROP POLICY IF EXISTS project_files_write ON storage.objects;
DROP POLICY IF EXISTS project_files_select ON storage.objects;
DROP POLICY IF EXISTS project_files_insert ON storage.objects;
DROP POLICY IF EXISTS project_files_update ON storage.objects;
DROP POLICY IF EXISTS project_files_delete ON storage.objects;

DROP POLICY IF EXISTS "Users can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view chat attachments in their conversations" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own attachments" ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_owner_insert ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_owner_delete ON storage.objects;

DROP POLICY IF EXISTS avatar_owner_insert ON storage.objects;
DROP POLICY IF EXISTS avatar_owner_update ON storage.objects;
DROP POLICY IF EXISTS avatar_owner_delete ON storage.objects;
DROP POLICY IF EXISTS profile_image_staging_read ON storage.objects;
DROP POLICY IF EXISTS profile_image_staging_write ON storage.objects;
DROP POLICY IF EXISTS profile_image_staging_delete ON storage.objects;

DROP POLICY IF EXISTS project_updates_media_public_read ON storage.objects;
DROP POLICY IF EXISTS project_updates_media_insert ON storage.objects;
DROP POLICY IF EXISTS project_updates_media_write ON storage.objects;
DROP POLICY IF EXISTS project_updates_media_delete ON storage.objects;
--> statement-breakpoint

ALTER TABLE public.storage_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_asset_operations ENABLE ROW LEVEL SECURITY;

-- Browser database roles may receive realtime rows, but file publication and
-- revision writes are server-owned. Keep Data API reads aligned with the same
-- files/tasks visibility predicate used by application routes.
CREATE OR REPLACE FUNCTION app_private.nb_project_node_can_read(
  p_project_id uuid,
  p_task_id uuid,
  p_path text,
  p_deleted_at timestamptz
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_deleted_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = p_project_id
      AND project.deleted_at IS NULL
      AND (
        project.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members member
          WHERE member.project_id = p_project_id
            AND member.user_id = (SELECT auth.uid())
        )
        OR (
          project.visibility = 'public'
          AND coalesce(project.status, 'draft') <> 'draft'
          AND coalesce(project.public_tab_visibility->>'files', 'true') = 'true'
          AND (
            (p_task_id IS NULL AND coalesce(p_path, '') NOT LIKE '/.system/%')
            OR coalesce(project.public_tab_visibility->>'tasks', 'false') = 'true'
          )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION app_private.nb_project_node_can_read(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.nb_project_node_can_read(uuid, uuid, text, timestamptz)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS project_nodes_read ON public.project_nodes;
DROP POLICY IF EXISTS project_nodes_public_read ON public.project_nodes;
CREATE POLICY project_nodes_read ON public.project_nodes
  FOR SELECT TO anon, authenticated
  USING (app_private.nb_project_node_can_read(project_id, task_id, path, deleted_at));
DROP POLICY IF EXISTS project_nodes_write ON public.project_nodes;

DROP POLICY IF EXISTS file_versions_read ON public.file_versions;
DROP POLICY IF EXISTS file_versions_public_read ON public.file_versions;
CREATE POLICY file_versions_read ON public.file_versions
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_nodes node
    WHERE node.id = file_versions.node_id
      AND app_private.nb_project_node_can_read(
        node.project_id,
        node.task_id,
        node.path,
        node.deleted_at
      )
  ));
DROP POLICY IF EXISTS file_versions_write ON public.file_versions;

-- The browser may inspect only its existing upload-intent projection. Asset
-- lifecycle and operation rows remain server-only and fail closed under RLS.
DROP POLICY IF EXISTS upload_intents_insert_own ON public.upload_intents;
DROP POLICY IF EXISTS upload_intents_update_own ON public.upload_intents;
DROP POLICY IF EXISTS "Users can create own upload intents" ON public.upload_intents;
DROP POLICY IF EXISTS "Users can update own upload intents" ON public.upload_intents;

DO $storage_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.upload_intents, public.storage_assets, public.storage_asset_operations, public.storage_quota_scopes, public.storage_asset_pins, public.storage_legacy_cleanup_targets, public.storage_repair_failures, public.project_update_media_assets, public.project_update_draft_media_assets, public.github_sync_snapshot_assets, public.project_nodes, public.file_versions
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.upload_intents, public.storage_assets, public.storage_asset_operations, public.storage_quota_scopes, public.storage_asset_pins, public.storage_legacy_cleanup_targets, public.storage_repair_failures, public.project_update_media_assets, public.project_update_draft_media_assets, public.github_sync_snapshot_assets, public.project_nodes, public.file_versions
      FROM authenticated;
  END IF;
END
$storage_roles$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.project_event_counters (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  next_sequence bigint NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.project_event_counters(project_id, next_sequence)
SELECT project.id, greatest(
  coalesce(project.current_sequence_number, 0),
  coalesce((SELECT max(event.sequence_number) FROM public.project_node_events event WHERE event.project_id = project.id), 0)
)
FROM public.projects project
ON CONFLICT (project_id) DO UPDATE
SET next_sequence = greatest(public.project_event_counters.next_sequence, excluded.next_sequence),
    updated_at = now();
ALTER TABLE public.project_event_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_event_counters FROM anon, authenticated;
GRANT ALL ON public.project_event_counters TO service_role;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.allocate_project_node_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE next_value bigint;
BEGIN
  IF NEW.sequence_number IS NULL OR NEW.sequence_number = 0 THEN
    INSERT INTO public.project_event_counters(project_id, next_sequence, updated_at)
    VALUES (NEW.project_id, 1, now())
    ON CONFLICT (project_id) DO UPDATE
      SET next_sequence = public.project_event_counters.next_sequence + 1,
          updated_at = now()
    RETURNING next_sequence INTO next_value;
    NEW.sequence_number := next_value;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.project_event_counters
      WHERE project_id = NEW.project_id AND next_sequence >= NEW.sequence_number
    ) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.project_event_counters(project_id, next_sequence, updated_at)
    VALUES (NEW.project_id, NEW.sequence_number, now())
    ON CONFLICT (project_id) DO UPDATE
      SET next_sequence = greatest(public.project_event_counters.next_sequence, excluded.next_sequence),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.record_file_content_contribution() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE project_uuid uuid;
BEGIN
  IF current_setting('app.maintenance_operation', true) IN ('hash_backfill', 'version_repair') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND (NEW.uploaded_by IS DISTINCT FROM auth.uid() OR NEW.attribution <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'File authorship must match the authenticated actor';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.s3_key IS NOT DISTINCT FROM OLD.s3_key
    AND NEW.size IS NOT DISTINCT FROM OLD.size
    AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.file_versions previous WHERE previous.node_id=NEW.node_id
      AND previous.version=NEW.version-1 AND previous.content_hash=NEW.content_hash
  ) THEN RETURN NEW; END IF;
  SELECT project_id INTO project_uuid FROM public.project_nodes WHERE id = NEW.node_id;
  INSERT INTO public.project_node_events(project_id,node_id,actor_id,type,sequence_number,metadata)
  VALUES (project_uuid,NEW.node_id,NEW.uploaded_by,'file_content_contributed',0,
    jsonb_build_object('version',NEW.version,'hash',NEW.content_hash,'source',COALESCE(NEW.attribution->>'source','edge'),'attribution',NEW.attribution));
  IF NEW.uploaded_by IS NOT NULL THEN
    UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now() WHERE profile_id=NEW.uploaded_by;
  END IF;
  RETURN NEW;
END $$;
