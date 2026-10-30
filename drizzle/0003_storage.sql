-- Storage assets, quotas, repair queues, buckets and storage.objects rules.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_storage_objects(p_bucket text, p_names text[], p_patterns text[]) RETURNS TABLE(name text, metadata jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY SELECT o.name::text, o.metadata
    FROM storage.objects o
    WHERE o.bucket_id = p_bucket AND (o.name = ANY (p_names) OR o.name LIKE ANY (p_patterns));
END;
$$;
--> statement-breakpoint
CREATE TABLE public.storage_asset_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    owner_user_id uuid,
    operation text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    result jsonb,
    error_code text,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT storage_asset_operations_operation_check CHECK ((operation = ANY (ARRAY['upload'::text, 'verify'::text, 'publish'::text, 'delete'::text, 'backup'::text]))),
    CONSTRAINT storage_asset_operations_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);
--> statement-breakpoint
CREATE TABLE public.storage_asset_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    kind text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_asset_pins_kind_check CHECK ((kind = 'export'::text))
);
--> statement-breakpoint
CREATE TABLE public.storage_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid,
    workspace_id uuid,
    bucket text NOT NULL,
    storage_key text NOT NULL,
    purpose text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    declared_mime_type text NOT NULL,
    declared_size bigint NOT NULL,
    verified_mime_type text,
    verified_size bigint,
    content_hash text,
    source_asset_id uuid,
    idempotency_key text,
    request_fingerprint text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    quota_tracked boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    verification_lease_token uuid,
    verification_lease_expires_at timestamp with time zone,
    verification_fence bigint DEFAULT 0 NOT NULL,
    delete_after timestamp with time zone,
    deletion_lease_token uuid,
    deletion_lease_expires_at timestamp with time zone,
    deletion_fence bigint DEFAULT 0 NOT NULL,
    backup_state text DEFAULT 'not_required'::text NOT NULL,
    last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_assets_backup_state_check CHECK ((backup_state = ANY (ARRAY['not_required'::text, 'pending'::text, 'verified'::text]))),
    CONSTRAINT storage_assets_declared_size_check CHECK ((declared_size >= 0)),
    CONSTRAINT storage_assets_deletion_fence_check CHECK ((deletion_fence >= 0)),
    CONSTRAINT storage_assets_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'verified'::text, 'delete_pending'::text, 'deleting'::text, 'deleted'::text, 'missing'::text]))),
    CONSTRAINT storage_assets_verification_fence_check CHECK ((verification_fence >= 0)),
    CONSTRAINT storage_assets_verified_fields_check CHECK (((state <> 'verified'::text) OR ((verified_at IS NOT NULL) AND (verified_size IS NOT NULL) AND (verified_mime_type IS NOT NULL)))),
    CONSTRAINT storage_assets_verified_size_check CHECK (((verified_size IS NULL) OR (verified_size >= 0)))
);
--> statement-breakpoint
CREATE TABLE public.storage_legacy_cleanup_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    source_workspace_id uuid,
    bucket text NOT NULL,
    storage_key text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    fence bigint DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT storage_legacy_cleanup_targets_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT storage_legacy_cleanup_targets_fence_check CHECK ((fence >= 0)),
    CONSTRAINT storage_legacy_cleanup_targets_source_type_check CHECK ((source_type = ANY (ARRAY['project_update_media'::text, 'project_update_draft_media'::text]))),
    CONSTRAINT storage_legacy_cleanup_targets_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'deleting'::text, 'retry'::text, 'deleted'::text])))
);
--> statement-breakpoint
CREATE TABLE public.storage_quota_scopes (
    scope_type text NOT NULL,
    scope_id uuid NOT NULL,
    limit_bytes bigint NOT NULL,
    reserved_bytes bigint DEFAULT 0 NOT NULL,
    retained_bytes bigint DEFAULT 0 NOT NULL,
    outstanding_uploads integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_quota_scopes_limit_bytes_check CHECK ((limit_bytes > 0)),
    CONSTRAINT storage_quota_scopes_outstanding_uploads_check CHECK ((outstanding_uploads >= 0)),
    CONSTRAINT storage_quota_scopes_reserved_bytes_check CHECK ((reserved_bytes >= 0)),
    CONSTRAINT storage_quota_scopes_retained_bytes_check CHECK ((retained_bytes >= 0)),
    CONSTRAINT storage_quota_scopes_scope_type_check CHECK ((scope_type = ANY (ARRAY['user'::text, 'project'::text])))
);
--> statement-breakpoint
CREATE TABLE public.storage_repair_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    repair_kind text NOT NULL,
    subject_id text NOT NULL,
    error_code text NOT NULL,
    detail text,
    attempts integer DEFAULT 1 NOT NULL,
    next_retry_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_repair_failures_attempts_check CHECK ((attempts > 0))
);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_asset_operations
    ADD CONSTRAINT storage_asset_operations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_asset_pins
    ADD CONSTRAINT storage_asset_pins_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_assets
    ADD CONSTRAINT storage_assets_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_legacy_cleanup_targets
    ADD CONSTRAINT storage_legacy_cleanup_targets_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_quota_scopes
    ADD CONSTRAINT storage_quota_scopes_pkey PRIMARY KEY (scope_type, scope_id);
--> statement-breakpoint
ALTER TABLE ONLY public.storage_repair_failures
    ADD CONSTRAINT storage_repair_failures_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX storage_asset_operations_asset_state_idx ON public.storage_asset_operations USING btree (asset_id, state);
--> statement-breakpoint
CREATE INDEX storage_asset_operations_lease_idx ON public.storage_asset_operations USING btree (state, lease_expires_at, id) WHERE (state = ANY (ARRAY['pending'::text, 'running'::text]));
--> statement-breakpoint
CREATE UNIQUE INDEX storage_asset_operations_owner_idempotency_unique ON public.storage_asset_operations USING btree (owner_user_id, idempotency_key) WHERE (owner_user_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX storage_asset_pins_asset_expiry_idx ON public.storage_asset_pins USING btree (asset_id, expires_at);
--> statement-breakpoint
CREATE INDEX storage_asset_pins_expiry_idx ON public.storage_asset_pins USING btree (expires_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX storage_asset_pins_operation_asset_unique ON public.storage_asset_pins USING btree (operation_id, asset_id);
--> statement-breakpoint
CREATE INDEX storage_assets_backup_due_idx ON public.storage_assets USING btree (verified_at, id) WHERE ((backup_state = 'pending'::text) AND (state = ANY (ARRAY['verified'::text, 'delete_pending'::text])));
--> statement-breakpoint
CREATE UNIQUE INDEX storage_assets_bucket_key_unique ON public.storage_assets USING btree (bucket, storage_key);
--> statement-breakpoint
CREATE INDEX storage_assets_deletion_due_idx ON public.storage_assets USING btree (delete_after, id) WHERE (state = 'delete_pending'::text);
--> statement-breakpoint
CREATE INDEX storage_assets_owner_idx ON public.storage_assets USING btree (owner_user_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX storage_assets_owner_purpose_idempotency_unique ON public.storage_assets USING btree (owner_user_id, purpose, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (owner_user_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX storage_assets_source_idx ON public.storage_assets USING btree (source_asset_id);
--> statement-breakpoint
CREATE INDEX storage_assets_state_expiry_idx ON public.storage_assets USING btree (state, expires_at, id);
--> statement-breakpoint
CREATE INDEX storage_assets_verification_lease_idx ON public.storage_assets USING btree (state, verification_lease_expires_at, id) WHERE (state = 'pending'::text);
--> statement-breakpoint
CREATE INDEX storage_assets_verification_work_idx ON public.storage_assets USING btree (verification_lease_expires_at, updated_at, id) WHERE ((state = 'pending'::text) AND ((verification_lease_token IS NOT NULL) OR (last_error_code IS NOT NULL)));
--> statement-breakpoint
CREATE INDEX storage_assets_workspace_idx ON public.storage_assets USING btree (workspace_id, created_at);
--> statement-breakpoint
CREATE INDEX storage_legacy_cleanup_due_idx ON public.storage_legacy_cleanup_targets USING btree (state, next_attempt_at, id);
--> statement-breakpoint
CREATE INDEX storage_legacy_cleanup_lease_idx ON public.storage_legacy_cleanup_targets USING btree (state, lease_expires_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX storage_legacy_cleanup_source_object_unique ON public.storage_legacy_cleanup_targets USING btree (source_type, source_id, source_workspace_id, bucket, storage_key);
--> statement-breakpoint
CREATE INDEX storage_quota_scopes_outstanding_idx ON public.storage_quota_scopes USING btree (outstanding_uploads, updated_at);
--> statement-breakpoint
CREATE INDEX storage_repair_failures_due_idx ON public.storage_repair_failures USING btree (repair_kind, resolved_at, next_retry_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX storage_repair_failures_subject_unique ON public.storage_repair_failures USING btree (repair_kind, subject_id);
--> statement-breakpoint
CREATE INDEX storage_repair_failures_unresolved_due_idx ON public.storage_repair_failures USING btree (next_retry_at, created_at, id) WHERE (resolved_at IS NULL);
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_avatar_asset_id_fkey FOREIGN KEY (avatar_asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_banner_asset_id_fkey FOREIGN KEY (banner_asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.storage_asset_operations
    ADD CONSTRAINT storage_asset_operations_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.storage_asset_operations
    ADD CONSTRAINT storage_asset_operations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.storage_asset_pins
    ADD CONSTRAINT storage_asset_pins_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.storage_assets
    ADD CONSTRAINT storage_assets_source_asset_id_fkey FOREIGN KEY (source_asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_asset_operations TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_asset_pins TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_legacy_cleanup_targets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_quota_scopes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.storage_repair_failures TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.storage_asset_operations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.storage_asset_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.storage_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.storage_legacy_cleanup_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.storage_quota_scopes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.storage_repair_failures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_storage_objects(p_bucket text, p_names text[], p_patterns text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_storage_objects(p_bucket text, p_names text[], p_patterns text[]) TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_asset_operations TO anon;
GRANT MAINTAIN ON TABLE public.storage_asset_operations TO authenticated;
GRANT ALL ON TABLE public.storage_asset_operations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_asset_operations TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_asset_pins TO anon;
GRANT MAINTAIN ON TABLE public.storage_asset_pins TO authenticated;
GRANT ALL ON TABLE public.storage_asset_pins TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_asset_pins TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_assets TO anon;
GRANT MAINTAIN ON TABLE public.storage_assets TO authenticated;
GRANT ALL ON TABLE public.storage_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_assets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_legacy_cleanup_targets TO anon;
GRANT MAINTAIN ON TABLE public.storage_legacy_cleanup_targets TO authenticated;
GRANT ALL ON TABLE public.storage_legacy_cleanup_targets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_legacy_cleanup_targets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_quota_scopes TO anon;
GRANT MAINTAIN ON TABLE public.storage_quota_scopes TO authenticated;
GRANT ALL ON TABLE public.storage_quota_scopes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_quota_scopes TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.storage_repair_failures TO anon;
GRANT MAINTAIN ON TABLE public.storage_repair_failures TO authenticated;
GRANT ALL ON TABLE public.storage_repair_failures TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_repair_failures TO nb_app;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('avatars', 'avatars', 't', 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('chat-attachments', 'chat-attachments', 'f', 52428800, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('contribution-images', 'contribution-images', 'f', 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('extension-recovery-drafts', 'extension-recovery-drafts', 'f', 10485760, ARRAY['text/plain', 'application/json', 'application/octet-stream']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('profile-image-staging', 'profile-image-staging', 'f', 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('project-files', 'project-files', 'f', 52428800, ARRAY['text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css', 'text/javascript', 'text/xml', 'application/json', 'application/xml', 'application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg', 'video/ogg', 'video/3gpp', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/flac', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/zip', 'application/x-zip-compressed', 'application/x-tar', 'application/gzip', 'application/x-gzip', 'application/x-7z-compressed', 'application/x-rar-compressed']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('project-updates-media', 'project-updates-media', 'f', 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('task-files', 'task-files', 'f', 52428800, ARRAY['text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css', 'text/javascript', 'text/xml', 'application/json', 'application/xml', 'application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg', 'video/ogg', 'video/3gpp', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/flac', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/zip', 'application/x-zip-compressed', 'application/x-tar', 'application/gzip', 'application/x-gzip', 'application/x-7z-compressed', 'application/x-rar-compressed']) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE POLICY task_files_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'task-files'::text) AND (owner = ( SELECT auth.uid() AS uid))));
--> statement-breakpoint
CREATE POLICY task_files_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'task-files'::text) AND (owner = ( SELECT auth.uid() AS uid)))) WITH CHECK (((bucket_id = 'task-files'::text) AND (owner = ( SELECT auth.uid() AS uid))));
