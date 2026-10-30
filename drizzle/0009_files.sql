-- File tree (workspace_nodes), versions, locks, conflicts, file index, upload intents.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
    -- Owners and admins see the whole tree and every copy.
    WHEN EXISTS (SELECT 1 FROM public.workspaces p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_project_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin')
      THEN true
    ELSE
      (p_task_id IS NULL OR app_private.nb_task_visible(p_task_id))
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_nodes f
        WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
          AND f.metadata->>'access' = 'admins'
          AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
      )
      AND (
        -- Members and guests read everything but Admins-only; visitors only under Public folders.
        EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p_project_id AND m.user_id = (SELECT auth.uid()))
        OR (
          EXISTS (
            SELECT 1 FROM public.workspace_nodes f
            WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'public'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.workspace_nodes f
            WHERE f.workspace_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'members'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
        )
      )
  END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_task_node_link_same_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t JOIN public.workspace_nodes n ON n.workspace_id = t.workspace_id
    WHERE t.id = NEW.task_id AND n.id = NEW.node_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'task_node_links: task and node belong to different projects';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_deleted_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.workspaces project
    WHERE project.id = p_project_id
      AND project.deleted_at IS NULL
      AND (
        project.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.workspace_members member
          WHERE member.workspace_id = p_project_id
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
      AND (project.kind <> 'organization' OR app_private.nb_org_node_access_ok(p_project_id, p_task_id, p_path))
  );
$$;
--> statement-breakpoint
CREATE FUNCTION public.allocate_workspace_node_event_sequence() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE next_value bigint;
BEGIN
  IF NEW.sequence_number IS NULL OR NEW.sequence_number = 0 THEN
    INSERT INTO public.workspace_event_counters(workspace_id, next_sequence, updated_at)
    VALUES (NEW.workspace_id, 1, now())
    ON CONFLICT (workspace_id) DO UPDATE
      SET next_sequence = public.workspace_event_counters.next_sequence + 1,
          updated_at = now()
    RETURNING next_sequence INTO next_value;
    NEW.sequence_number := next_value;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.workspace_event_counters
      WHERE workspace_id = NEW.workspace_id AND next_sequence >= NEW.sequence_number
    ) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.workspace_event_counters(workspace_id, next_sequence, updated_at)
    VALUES (NEW.workspace_id, NEW.sequence_number, now())
    ON CONFLICT (workspace_id) DO UPDATE
      SET next_sequence = greatest(public.workspace_event_counters.next_sequence, excluded.next_sequence),
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.file_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    version integer NOT NULL,
    s3_key text NOT NULL,
    size bigint NOT NULL,
    mime_type text NOT NULL,
    content_hash text,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    comment text,
    attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    asset_id uuid
);
--> statement-breakpoint
CREATE TABLE public.workspace_file_index (
    node_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_git_deltas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid,
    target_branch text NOT NULL,
    sequence_number bigint NOT NULL,
    delta_order integer NOT NULL,
    action text NOT NULL,
    node_id uuid,
    path text NOT NULL,
    old_path text,
    git_blob_hash text,
    file_version_id uuid,
    s3_key text,
    status text DEFAULT 'pending'::text NOT NULL,
    job_id uuid,
    processed_commit_sha text,
    processing_error text,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_git_deltas_action_check CHECK ((action = ANY (ARRAY['add'::text, 'modify'::text, 'delete'::text, 'rename'::text]))),
    CONSTRAINT workspace_git_deltas_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.workspace_node_conflicts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    node_id uuid NOT NULL,
    task_id uuid,
    git_branch text NOT NULL,
    canonical_content text,
    incoming_content text,
    merged_content text,
    conflict_status text DEFAULT 'unresolved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_node_conflicts_conflict_status_check CHECK ((conflict_status = ANY (ARRAY['unresolved'::text, 'resolved'::text])))
);
--> statement-breakpoint
CREATE TABLE public.workspace_node_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    node_id uuid,
    actor_id uuid,
    type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sequence_number bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE public.workspace_node_lock_fencing_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE public.workspace_node_locks (
    node_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    locked_by uuid NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    session_id uuid NOT NULL,
    lease_id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_kind text DEFAULT 'web'::text NOT NULL,
    device_session_id uuid,
    fencing_token bigint DEFAULT nextval('public.workspace_node_lock_fencing_seq'::regclass) NOT NULL,
    renewed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_node_locks_client_kind_check CHECK ((client_kind = ANY (ARRAY['web'::text, 'vscode'::text])))
);

ALTER TABLE ONLY public.workspace_node_locks REPLICA IDENTITY FULL;
--> statement-breakpoint
CREATE TABLE public.workspace_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    parent_id uuid,
    type text NOT NULL,
    name text NOT NULL,
    s3_key text,
    size bigint DEFAULT 0,
    mime_type text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_by uuid,
    deleted_at timestamp with time zone,
    git_blob_hash text,
    path text DEFAULT '/'::text NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    task_id uuid,
    canonical_node_id uuid,
    last_synced_commit_sha text,
    sync_status text DEFAULT 'merged'::text NOT NULL,
    asset_id uuid,
    CONSTRAINT workspace_nodes_no_self_parent_check CHECK (((parent_id IS NULL) OR (parent_id <> id))),
    CONSTRAINT workspace_nodes_sync_status_check CHECK ((sync_status = ANY (ARRAY['draft'::text, 'ready_for_review'::text, 'merged'::text, 'git_synced'::text, 'deleted_tombstone'::text])))
);
--> statement-breakpoint
CREATE TABLE public.task_node_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    node_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    "order" integer DEFAULT 0 NOT NULL,
    annotation text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.upload_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid,
    bucket text NOT NULL,
    storage_key text NOT NULL,
    scope text NOT NULL,
    kind text NOT NULL,
    expected_mime_type text NOT NULL,
    expected_size bigint NOT NULL,
    finalized_mime_type text,
    finalized_size bigint,
    status public.status_file DEFAULT 'pending'::public.status_file NOT NULL,
    failure_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    asset_id uuid
);
--> statement-breakpoint
ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_node_links
    ADD CONSTRAINT task_node_links_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_file_index
    ADD CONSTRAINT workspace_file_index_pkey PRIMARY KEY (node_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_seq_unique UNIQUE (workspace_id, target_branch, sequence_number, delta_order);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_conflicts
    ADD CONSTRAINT workspace_node_conflicts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_events
    ADD CONSTRAINT workspace_node_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_pkey PRIMARY KEY (node_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX file_versions_asset_idx ON public.file_versions USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX file_versions_content_hash_idx ON public.file_versions USING btree (content_hash);
--> statement-breakpoint
CREATE INDEX file_versions_node_uploaded_at_idx ON public.file_versions USING btree (node_id, uploaded_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX file_versions_node_version_unique ON public.file_versions USING btree (node_id, version);
--> statement-breakpoint
CREATE INDEX file_versions_s3_key_idx ON public.file_versions USING btree (s3_key) WHERE (s3_key <> ''::text);
--> statement-breakpoint
CREATE INDEX file_versions_uploaded_by_idx ON public.file_versions USING btree (uploaded_by);
--> statement-breakpoint
CREATE UNIQUE INDEX project_nodes_project_id_id_key ON public.workspace_nodes USING btree (workspace_id, id);
--> statement-breakpoint
CREATE INDEX task_node_links_created_by_idx ON public.task_node_links USING btree (created_by);
--> statement-breakpoint
CREATE INDEX task_node_links_node_id_idx ON public.task_node_links USING btree (node_id);
--> statement-breakpoint
CREATE INDEX task_node_links_task_id_idx ON public.task_node_links USING btree (task_id);
--> statement-breakpoint
CREATE INDEX task_node_links_task_linked_at_idx ON public.task_node_links USING btree (task_id, linked_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX task_node_links_unique_idx ON public.task_node_links USING btree (task_id, node_id);
--> statement-breakpoint
CREATE UNIQUE INDEX upload_intents_asset_unique ON public.upload_intents USING btree (asset_id) WHERE (asset_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX upload_intents_bucket_key_unique ON public.upload_intents USING btree (bucket, storage_key);
--> statement-breakpoint
CREATE INDEX upload_intents_status_expires_idx ON public.upload_intents USING btree (status, expires_at);
--> statement-breakpoint
CREATE INDEX upload_intents_user_idx ON public.upload_intents USING btree (user_id, created_at);
--> statement-breakpoint
CREATE INDEX upload_intents_workspace_idx ON public.upload_intents USING btree (workspace_id, created_at);
--> statement-breakpoint
CREATE INDEX upload_intents_workspace_status_idx ON public.upload_intents USING btree (workspace_id, status);
--> statement-breakpoint
CREATE INDEX workspace_file_index_content_search_idx ON public.workspace_file_index USING gin (content extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX workspace_file_index_workspace_id_idx ON public.workspace_file_index USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_git_deltas_file_version_idx ON public.workspace_git_deltas USING btree (file_version_id);
--> statement-breakpoint
CREATE INDEX workspace_git_deltas_node_idx ON public.workspace_git_deltas USING btree (node_id);
--> statement-breakpoint
CREATE INDEX workspace_git_deltas_sync_idx ON public.workspace_git_deltas USING btree (workspace_id, target_branch, status, sequence_number, delta_order);
--> statement-breakpoint
CREATE INDEX workspace_git_deltas_task_idx ON public.workspace_git_deltas USING btree (task_id);
--> statement-breakpoint
CREATE INDEX workspace_node_conflicts_node_idx ON public.workspace_node_conflicts USING btree (node_id);
--> statement-breakpoint
CREATE INDEX workspace_node_conflicts_task_idx ON public.workspace_node_conflicts USING btree (task_id);
--> statement-breakpoint
CREATE INDEX workspace_node_conflicts_workspace_idx ON public.workspace_node_conflicts USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_node_events_actor_id_idx ON public.workspace_node_events USING btree (actor_id);
--> statement-breakpoint
CREATE INDEX workspace_node_events_node_idx ON public.workspace_node_events USING btree (node_id, created_at);
--> statement-breakpoint
CREATE INDEX workspace_node_events_operation_idx ON public.workspace_node_events USING btree (workspace_id, actor_id, ((metadata ->> 'operationId'::text)));
--> statement-breakpoint
CREATE INDEX workspace_node_events_reconciliation_key_idx ON public.workspace_node_events USING btree (workspace_id, ((metadata ->> 'reconciliationKey'::text)));
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_node_events_seq_idx ON public.workspace_node_events USING btree (workspace_id, sequence_number, created_at);
--> statement-breakpoint
CREATE INDEX workspace_node_events_workspace_idx ON public.workspace_node_events USING btree (workspace_id, created_at);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_cleanup_idx ON public.workspace_node_locks USING btree (workspace_id, session_id);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_device_session_idx ON public.workspace_node_locks USING btree (device_session_id) WHERE (device_session_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_expires_idx ON public.workspace_node_locks USING btree (expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_node_locks_lease_unique ON public.workspace_node_locks USING btree (lease_id);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_locked_by_idx ON public.workspace_node_locks USING btree (locked_by);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_owner_session_idx ON public.workspace_node_locks USING btree (locked_by, session_id);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_workspace_expires_idx ON public.workspace_node_locks USING btree (workspace_id, expires_at);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_workspace_id_idx ON public.workspace_node_locks USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_node_locks_workspace_node_expires_idx ON public.workspace_node_locks USING btree (workspace_id, node_id, expires_at);
--> statement-breakpoint
CREATE INDEX workspace_nodes_access_folders_idx ON public.workspace_nodes USING btree (workspace_id, path) WHERE ((type = 'folder'::text) AND (deleted_at IS NULL) AND (metadata ? 'access'::text));
--> statement-breakpoint
CREATE INDEX workspace_nodes_active_file_idx ON public.workspace_nodes USING btree (workspace_id, id) WHERE ((type = 'file'::text) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE INDEX workspace_nodes_active_file_s3_key_idx ON public.workspace_nodes USING btree (s3_key text_pattern_ops) WHERE ((type = 'file'::text) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE INDEX workspace_nodes_active_name_lookup_idx ON public.workspace_nodes USING btree (workspace_id, parent_id, lower(name)) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_nodes_active_parent_idx ON public.workspace_nodes USING btree (workspace_id, parent_id) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_nodes_active_parent_name_unique ON public.workspace_nodes USING btree (workspace_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name), COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_nodes_active_workspace_path_unique ON public.workspace_nodes USING btree (workspace_id, path, COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_nodes_asset_idx ON public.workspace_nodes USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_canonical_idx ON public.workspace_nodes USING btree (workspace_id, canonical_node_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_canonical_node_idx ON public.workspace_nodes USING btree (canonical_node_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_created_by_idx ON public.workspace_nodes USING btree (created_by);
--> statement-breakpoint
CREATE INDEX workspace_nodes_deleted_at_partial_idx ON public.workspace_nodes USING btree (deleted_at) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_nodes_deleted_by_idx ON public.workspace_nodes USING btree (deleted_by);
--> statement-breakpoint
CREATE INDEX workspace_nodes_file_s3_key_idx ON public.workspace_nodes USING btree (s3_key) WHERE ((type = 'file'::text) AND (s3_key IS NOT NULL));
--> statement-breakpoint
CREATE INDEX workspace_nodes_listing_idx ON public.workspace_nodes USING btree (workspace_id, parent_id, type, name);
--> statement-breakpoint
CREATE INDEX workspace_nodes_parent_id_idx ON public.workspace_nodes USING btree (parent_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_path_idx ON public.workspace_nodes USING btree (path);
--> statement-breakpoint
CREATE INDEX workspace_nodes_permanent_delete_root_idx ON public.workspace_nodes USING btree (updated_at) WHERE ((deleted_at IS NOT NULL) AND ((metadata ->> 'permanentDeleteRoot'::text) = (id)::text));
--> statement-breakpoint
CREATE INDEX workspace_nodes_root_covering_idx ON public.workspace_nodes USING btree (workspace_id, type, name) WHERE ((parent_id IS NULL) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE INDEX workspace_nodes_sync_git_idx ON public.workspace_nodes USING btree (workspace_id, sync_status, git_blob_hash);
--> statement-breakpoint
CREATE INDEX workspace_nodes_task_idx ON public.workspace_nodes USING btree (task_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_task_status_idx ON public.workspace_nodes USING btree (workspace_id, task_id, sync_status);
--> statement-breakpoint
CREATE INDEX workspace_nodes_workspace_deleted_updated_idx ON public.workspace_nodes USING btree (workspace_id, deleted_at, updated_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_nodes_workspace_id_idx ON public.workspace_nodes USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_nodes_workspace_path_idx ON public.workspace_nodes USING btree (workspace_id, path);
--> statement-breakpoint
CREATE INDEX workspace_nodes_workspace_updated_idx ON public.workspace_nodes USING btree (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE TRIGGER task_node_links_before_write_same_workspace_trigger BEFORE INSERT OR UPDATE OF task_id, node_id ON public.task_node_links FOR EACH ROW EXECUTE FUNCTION app_private.nb_task_node_link_same_workspace();
--> statement-breakpoint
CREATE TRIGGER workspace_node_events_sequence_before_insert BEFORE INSERT ON public.workspace_node_events FOR EACH ROW EXECUTE FUNCTION public.allocate_workspace_node_event_sequence();
--> statement-breakpoint
ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_node_id_workspace_nodes_id_fk FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_uploaded_by_profiles_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_node_links
    ADD CONSTRAINT task_node_links_created_by_profiles_id_fk FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_node_links
    ADD CONSTRAINT task_node_links_node_id_workspace_nodes_id_fk FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_node_links
    ADD CONSTRAINT task_node_links_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.upload_intents
    ADD CONSTRAINT upload_intents_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_file_index
    ADD CONSTRAINT workspace_file_index_node_id_workspace_nodes_id_fk FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_file_index
    ADD CONSTRAINT workspace_file_index_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_file_version_id_fkey FOREIGN KEY (file_version_id) REFERENCES public.file_versions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_git_deltas
    ADD CONSTRAINT workspace_git_deltas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_conflicts
    ADD CONSTRAINT workspace_node_conflicts_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_conflicts
    ADD CONSTRAINT workspace_node_conflicts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_conflicts
    ADD CONSTRAINT workspace_node_conflicts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_events
    ADD CONSTRAINT workspace_node_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_events
    ADD CONSTRAINT workspace_node_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_events
    ADD CONSTRAINT workspace_node_events_workspace_id_node_id_fkey FOREIGN KEY (workspace_id, node_id) REFERENCES public.workspace_nodes(workspace_id, id) ON DELETE SET NULL (node_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_locked_by_profiles_id_fk FOREIGN KEY (locked_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_node_id_workspace_nodes_id_fk FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_created_by_profiles_id_fk FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_deleted_by_profiles_id_fk FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_workspace_id_canonical_node_id_fkey FOREIGN KEY (workspace_id, canonical_node_id) REFERENCES public.workspace_nodes(workspace_id, id) ON DELETE SET NULL (canonical_node_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_workspace_id_parent_id_fkey FOREIGN KEY (workspace_id, parent_id) REFERENCES public.workspace_nodes(workspace_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_workspace_id_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES public.tasks(workspace_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_nodes
    ADD CONSTRAINT workspace_nodes_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY file_versions_insert_workspace_member ON public.file_versions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.workspace_nodes pn
     JOIN public.workspaces p ON ((pn.workspace_id = p.id)))
  WHERE ((pn.id = file_versions.node_id) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role <> 'viewer'::text)))))))));
--> statement-breakpoint
CREATE POLICY file_versions_read ON public.file_versions FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.workspace_nodes node
  WHERE ((node.id = file_versions.node_id) AND app_private.nb_workspace_node_can_read(node.workspace_id, node.task_id, node.path, node.deleted_at)))));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.file_versions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_node_links TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.upload_intents TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_file_index TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_git_deltas TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_node_conflicts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_node_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_node_locks TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_nodes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.task_node_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_node_links_delete_workspace_writer ON public.task_node_links FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_node_links.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
CREATE POLICY task_node_links_insert_workspace_writer ON public.task_node_links FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_node_links.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
CREATE POLICY task_node_links_read ON public.task_node_links FOR SELECT TO authenticated, anon USING (app_private.nb_task_visible(task_id));
--> statement-breakpoint
CREATE POLICY task_node_links_update_workspace_writer ON public.task_node_links FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_node_links.task_id) AND app_private.nb_workspace_can_write(t.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_node_links.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
ALTER TABLE public.upload_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY upload_intents_select_own ON public.upload_intents FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));
--> statement-breakpoint
ALTER TABLE public.workspace_file_index ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_file_index_delete_workspace_writer ON public.workspace_file_index FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_file_index_insert_workspace_writer ON public.workspace_file_index FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_file_index_read ON public.workspace_file_index FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.workspace_nodes node
  WHERE ((node.id = workspace_file_index.node_id) AND (node.workspace_id = workspace_file_index.workspace_id) AND app_private.nb_workspace_node_can_read(node.workspace_id, node.task_id, node.path, node.deleted_at)))));
--> statement-breakpoint
CREATE POLICY workspace_file_index_update_workspace_writer ON public.workspace_file_index FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_git_deltas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_node_conflicts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_node_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_node_events_delete_workspace_writer ON public.workspace_node_events FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_node_events_insert_workspace_writer ON public.workspace_node_events FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_node_events_select_workspace_member ON public.workspace_node_events FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_node_events.workspace_id) AND (p.deleted_at IS NULL) AND (p.owner_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = workspace_node_events.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));
--> statement-breakpoint
CREATE POLICY workspace_node_events_update_workspace_writer ON public.workspace_node_events FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_node_locks_select_workspace_member ON public.workspace_node_locks FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_node_locks.workspace_id) AND (p.deleted_at IS NULL) AND (p.owner_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = workspace_node_locks.workspace_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))));
--> statement-breakpoint
ALTER TABLE public.workspace_nodes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_nodes_delete_workspace_writer ON public.workspace_nodes FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_nodes_insert_workspace_writer ON public.workspace_nodes FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_nodes_read ON public.workspace_nodes FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_node_can_read(workspace_id, task_id, path, deleted_at));
--> statement-breakpoint
CREATE POLICY workspace_nodes_update_workspace_writer ON public.workspace_nodes FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) TO anon;
GRANT ALL ON FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text) TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_task_node_link_same_workspace() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_node_can_read(p_project_id uuid, p_task_id uuid, p_path text, p_deleted_at timestamp with time zone) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.allocate_workspace_node_event_sequence() FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_workspace_node_event_sequence() TO service_role;
GRANT ALL ON FUNCTION public.allocate_workspace_node_event_sequence() TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.file_versions TO anon;
GRANT MAINTAIN ON TABLE public.file_versions TO authenticated;
GRANT ALL ON TABLE public.file_versions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.file_versions TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_file_index TO anon;
GRANT MAINTAIN ON TABLE public.workspace_file_index TO authenticated;
GRANT ALL ON TABLE public.workspace_file_index TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_file_index TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_git_deltas TO anon;
GRANT MAINTAIN ON TABLE public.workspace_git_deltas TO authenticated;
GRANT ALL ON TABLE public.workspace_git_deltas TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_git_deltas TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_node_conflicts TO anon;
GRANT MAINTAIN ON TABLE public.workspace_node_conflicts TO authenticated;
GRANT ALL ON TABLE public.workspace_node_conflicts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_node_conflicts TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_node_events TO anon;
GRANT MAINTAIN ON TABLE public.workspace_node_events TO authenticated;
GRANT ALL ON TABLE public.workspace_node_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_node_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON SEQUENCE public.workspace_node_lock_fencing_seq TO service_role;
GRANT ALL ON SEQUENCE public.workspace_node_lock_fencing_seq TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_node_locks TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_node_locks TO authenticated;
GRANT ALL ON TABLE public.workspace_node_locks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_node_locks TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_nodes TO anon;
GRANT MAINTAIN ON TABLE public.workspace_nodes TO authenticated;
GRANT ALL ON TABLE public.workspace_nodes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_nodes TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.task_node_links TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.task_node_links TO authenticated;
GRANT ALL ON TABLE public.task_node_links TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_node_links TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.upload_intents TO anon;
GRANT MAINTAIN ON TABLE public.upload_intents TO authenticated;
GRANT ALL ON TABLE public.upload_intents TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.upload_intents TO nb_app;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_node_links;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_node_locks;
