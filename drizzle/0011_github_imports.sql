-- GitHub sync and import jobs.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE TABLE public.github_contributor_identities (
    user_id uuid NOT NULL,
    github_id bigint NOT NULL,
    login text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    avatar_url text,
    approved_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.github_sync_connections (
    workspace_id uuid NOT NULL,
    repository text NOT NULL,
    repository_id bigint NOT NULL,
    branch text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    installation_id bigint,
    incoming_sha text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.github_sync_files (
    workspace_id uuid NOT NULL,
    repository_id bigint NOT NULL,
    branch text NOT NULL,
    path text NOT NULL,
    node_id uuid,
    blob_sha text,
    local_hash text,
    local_blob_sha text,
    commit_sha text NOT NULL,
    sequence bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.github_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    status text DEFAULT 'review'::text NOT NULL,
    stage text DEFAULT 'Ready for review'::text NOT NULL,
    manifest jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    credential jsonb,
    error text,
    lease_id uuid,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT github_sync_runs_status_check CHECK ((status = ANY (ARRAY['review'::text, 'queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'needs_review'::text, 'cancelled'::text])))
);
--> statement-breakpoint
CREATE TABLE public.github_sync_snapshot_assets (
    run_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.import_job_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    path text NOT NULL,
    size bigint NOT NULL,
    checksum text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    upload_intent_id uuid,
    s3_key text,
    error_message text,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_job_files_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'uploading'::text, 'completed'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    total_files integer DEFAULT 0 NOT NULL,
    processed_files integer DEFAULT 0 NOT NULL,
    manifest_s3_key text,
    manifest_hash text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manifest_asset_id uuid,
    manifest_upload_intent_id uuid,
    CONSTRAINT import_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'importing'::text, 'completed'::text, 'failed'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.github_contributor_identities
    ADD CONSTRAINT github_contributor_identities_pkey PRIMARY KEY (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_connections
    ADD CONSTRAINT github_sync_connections_pkey PRIMARY KEY (workspace_id);
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_files
    ADD CONSTRAINT github_sync_files_pkey PRIMARY KEY (workspace_id, repository_id, branch, path);
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_runs
    ADD CONSTRAINT github_sync_runs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_snapshot_assets
    ADD CONSTRAINT github_sync_snapshot_assets_pkey PRIMARY KEY (run_id, asset_id);
--> statement-breakpoint
ALTER TABLE ONLY public.import_job_files
    ADD CONSTRAINT import_job_files_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE UNIQUE INDEX github_contributor_identity_unique ON public.github_contributor_identities USING btree (github_id);
--> statement-breakpoint
CREATE INDEX github_sync_files_blob_sha_idx ON public.github_sync_files USING btree (workspace_id, blob_sha);
--> statement-breakpoint
CREATE INDEX github_sync_files_local_sha_idx ON public.github_sync_files USING btree (workspace_id, local_blob_sha);
--> statement-breakpoint
CREATE INDEX github_sync_files_node_idx ON public.github_sync_files USING btree (node_id);
--> statement-breakpoint
CREATE UNIQUE INDEX github_sync_runs_active_idx ON public.github_sync_runs USING btree (workspace_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
--> statement-breakpoint
CREATE INDEX github_sync_runs_actor_idx ON public.github_sync_runs USING btree (actor_id);
--> statement-breakpoint
CREATE INDEX github_sync_runs_queue_idx ON public.github_sync_runs USING btree (status, updated_at);
--> statement-breakpoint
CREATE INDEX github_sync_runs_workspace_idx ON public.github_sync_runs USING btree (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX github_sync_snapshot_assets_asset_idx ON public.github_sync_snapshot_assets USING btree (asset_id);
--> statement-breakpoint
CREATE UNIQUE INDEX github_sync_snapshot_assets_run_path_unique ON public.github_sync_snapshot_assets USING btree (run_id, path);
--> statement-breakpoint
CREATE INDEX import_job_files_status_idx ON public.import_job_files USING btree (job_id, status);
--> statement-breakpoint
CREATE INDEX import_job_files_upload_intent_idx ON public.import_job_files USING btree (upload_intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX import_jobs_manifest_asset_unique ON public.import_jobs USING btree (manifest_asset_id) WHERE (manifest_asset_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX import_jobs_manifest_intent_idx ON public.import_jobs USING btree (manifest_upload_intent_id);
--> statement-breakpoint
CREATE INDEX import_jobs_workspace_idx ON public.import_jobs USING btree (workspace_id);
--> statement-breakpoint
ALTER TABLE ONLY public.github_contributor_identities
    ADD CONSTRAINT github_contributor_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_connections
    ADD CONSTRAINT github_sync_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_files
    ADD CONSTRAINT github_sync_files_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_files
    ADD CONSTRAINT github_sync_files_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_runs
    ADD CONSTRAINT github_sync_runs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_runs
    ADD CONSTRAINT github_sync_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_snapshot_assets
    ADD CONSTRAINT github_sync_snapshot_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.github_sync_snapshot_assets
    ADD CONSTRAINT github_sync_snapshot_assets_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.github_sync_runs(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.import_job_files
    ADD CONSTRAINT import_job_files_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.import_job_files
    ADD CONSTRAINT import_job_files_upload_intent_id_fkey FOREIGN KEY (upload_intent_id) REFERENCES public.upload_intents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_manifest_asset_id_fkey FOREIGN KEY (manifest_asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_manifest_upload_intent_id_fkey FOREIGN KEY (manifest_upload_intent_id) REFERENCES public.upload_intents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.github_contributor_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.github_sync_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.github_sync_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.github_sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.github_sync_snapshot_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.import_job_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.github_contributor_identities TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.github_sync_connections TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.github_sync_files TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.github_sync_runs TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.github_sync_snapshot_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.import_job_files TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.import_jobs TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT ALL ON TABLE public.github_contributor_identities TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.github_contributor_identities TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.github_sync_connections TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.github_sync_connections TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.github_sync_files TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.github_sync_files TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.github_sync_runs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.github_sync_runs TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.github_sync_snapshot_assets TO anon;
GRANT MAINTAIN ON TABLE public.github_sync_snapshot_assets TO authenticated;
GRANT ALL ON TABLE public.github_sync_snapshot_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.github_sync_snapshot_assets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.import_job_files TO anon;
GRANT MAINTAIN ON TABLE public.import_job_files TO authenticated;
GRANT ALL ON TABLE public.import_job_files TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.import_job_files TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.import_jobs TO anon;
GRANT MAINTAIN ON TABLE public.import_jobs TO authenticated;
GRANT ALL ON TABLE public.import_jobs TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.import_jobs TO nb_app;
