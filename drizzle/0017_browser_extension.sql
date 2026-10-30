-- Extension device sessions, recovery sessions and drafts.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE TABLE public.extension_device_session_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    ip_address text,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extension_device_session_events_event_type_check CHECK ((event_type = ANY (ARRAY['login'::text, 'file_write'::text, 'lock_acquire'::text, 'logout'::text, 'revocation'::text, 'auth_code_issued'::text, 'auth_code_consumed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.extension_device_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    device_name text NOT NULL,
    client_version text NOT NULL,
    scopes jsonb DEFAULT '[]'::jsonb,
    ip_address text,
    user_agent text,
    revocation_reason text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    editor_host text,
    editor_name text,
    editor_platform text,
    editor_version text,
    callback_uri text
);
--> statement-breakpoint
CREATE TABLE public.extension_recovery_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    node_id uuid,
    device_id text NOT NULL,
    session_id text NOT NULL,
    file_path text NOT NULL,
    storage_key text NOT NULL,
    size bigint NOT NULL,
    mime_type text DEFAULT 'text/plain'::text NOT NULL,
    content_hash text NOT NULL,
    base_version integer,
    base_hash text,
    task_context jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    failure_reason text,
    captured_at timestamp with time zone NOT NULL,
    finalized_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    asset_id uuid,
    CONSTRAINT extension_recovery_drafts_base_hash_check CHECK (((base_hash IS NULL) OR (base_hash ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT extension_recovery_drafts_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT extension_recovery_drafts_size_check CHECK (((size >= 0) AND (size <= 10485760))),
    CONSTRAINT extension_recovery_drafts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'finalized'::text, 'failed'::text, 'expired'::text])))
);
--> statement-breakpoint
CREATE TABLE public.extension_recovery_sessions (
    session_id text NOT NULL,
    user_id uuid NOT NULL,
    device_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    extension_version text,
    started_at timestamp with time zone NOT NULL,
    last_heartbeat_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    incident_detected_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT extension_recovery_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'clean'::text, 'interrupted'::text, 'resolved'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_device_session_events
    ADD CONSTRAINT extension_device_session_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_device_sessions
    ADD CONSTRAINT extension_device_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_device_sessions
    ADD CONSTRAINT extension_device_sessions_token_hash_unique UNIQUE (token_hash);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_storage_key_unique UNIQUE (storage_key);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_sessions
    ADD CONSTRAINT extension_recovery_sessions_pkey PRIMARY KEY (session_id);
--> statement-breakpoint
CREATE INDEX extension_device_session_events_retention_idx ON public.extension_device_session_events USING btree (created_at, id);
--> statement-breakpoint
CREATE INDEX extension_device_session_events_session_idx ON public.extension_device_session_events USING btree (session_id);
--> statement-breakpoint
CREATE INDEX extension_device_sessions_editor_metadata_idx ON public.extension_device_sessions USING btree (user_id, editor_host, revoked_at, expires_at);
--> statement-breakpoint
CREATE INDEX extension_device_sessions_lookup_idx ON public.extension_device_sessions USING btree (token_prefix, token_hash, user_id, revoked_at, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX extension_recovery_drafts_asset_unique ON public.extension_recovery_drafts USING btree (asset_id) WHERE (asset_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_device_file_idx ON public.extension_recovery_drafts USING btree (user_id, device_id, workspace_id, file_path, captured_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_expiry_idx ON public.extension_recovery_drafts USING btree (status, expires_at);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_node_idx ON public.extension_recovery_drafts USING btree (node_id);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_owner_updated_idx ON public.extension_recovery_drafts USING btree (user_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_path_time_idx ON public.extension_recovery_drafts USING btree (user_id, workspace_id, file_path, captured_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_drafts_workspace_path_idx ON public.extension_recovery_drafts USING btree (workspace_id, file_path, updated_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_sessions_owner_device_idx ON public.extension_recovery_sessions USING btree (user_id, device_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_sessions_owner_status_heartbeat_idx ON public.extension_recovery_sessions USING btree (user_id, status, last_heartbeat_at DESC);
--> statement-breakpoint
CREATE INDEX extension_recovery_sessions_updated_idx ON public.extension_recovery_sessions USING btree (updated_at);
--> statement-breakpoint
CREATE INDEX extension_recovery_sessions_user_device_idx ON public.extension_recovery_sessions USING btree (user_id, session_id, device_id);
--> statement-breakpoint
ALTER TABLE ONLY public.extension_device_session_events
    ADD CONSTRAINT extension_device_session_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.extension_device_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_device_sessions
    ADD CONSTRAINT extension_device_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_drafts
    ADD CONSTRAINT extension_recovery_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.extension_recovery_sessions
    ADD CONSTRAINT extension_recovery_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_device_session_fk FOREIGN KEY (device_session_id) REFERENCES public.extension_device_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.extension_device_session_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.extension_device_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.extension_recovery_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY extension_recovery_drafts_delete_own ON public.extension_recovery_drafts FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY extension_recovery_drafts_insert_own ON public.extension_recovery_drafts FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY extension_recovery_drafts_select_own ON public.extension_recovery_drafts FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
CREATE POLICY extension_recovery_drafts_update_own ON public.extension_recovery_drafts FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.extension_recovery_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.extension_device_session_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.extension_device_sessions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.extension_recovery_drafts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.extension_recovery_sessions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.extension_device_session_events TO anon;
GRANT MAINTAIN ON TABLE public.extension_device_session_events TO authenticated;
GRANT ALL ON TABLE public.extension_device_session_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.extension_device_session_events TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.extension_device_sessions TO anon;
GRANT MAINTAIN ON TABLE public.extension_device_sessions TO authenticated;
GRANT ALL ON TABLE public.extension_device_sessions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.extension_device_sessions TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.extension_recovery_drafts TO anon;
GRANT MAINTAIN ON TABLE public.extension_recovery_drafts TO authenticated;
GRANT ALL ON TABLE public.extension_recovery_drafts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.extension_recovery_drafts TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.extension_recovery_sessions TO authenticated;
GRANT ALL ON TABLE public.extension_recovery_sessions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.extension_recovery_sessions TO nb_app;
