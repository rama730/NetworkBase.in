-- Tasks, subtasks, comments, sprints, board columns, task events.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_task_visible(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.workspaces p ON p.id = t.workspace_id
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND app_private.nb_workspace_tab_visible(t.workspace_id, 'tasks')
      AND (
        p.kind <> 'organization'
        OR p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p.id AND pm.user_id = (SELECT auth.uid()) AND pm.role = 'admin')
        OR (t.kind = 'assignment' AND t.assignment_id IS NULL)
        OR t.assignee_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = (SELECT auth.uid()))
      )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION public.seed_workspace_workflow_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.workspace_workflow_columns (
    workspace_id, status, title, accent_class_name, empty_title,
    empty_description, position, is_default
  )
  VALUES
    (NEW.id, 'todo', 'To do', 'zinc', 'Tasks will appear here…', 'Tasks that are ready to start will appear here. Drag and drop your tasks here.', 0, TRUE),
    (NEW.id, 'in_progress', 'In progress', 'blue', 'Tasks will appear here…', 'Items will appear here as soon as they start. Drag and drop your tasks here.', 1, TRUE),
    (NEW.id, 'blocked', 'Blocked', 'rose', 'Tasks will appear here…', 'Tasks waiting on blockers will appear here. Drag and drop your tasks here.', 2, TRUE),
    (NEW.id, 'done', 'Completed', 'emerald', 'Tasks will appear here…', 'Finished work will appear here. Drag and drop your tasks here.', 3, TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE public.comment_mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comment_id uuid NOT NULL,
    mentioned_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_sprint_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sprint_id uuid NOT NULL,
    actor_id uuid,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_sprints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    goal text,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    status public.status_sprint DEFAULT 'planning'::public.status_sprint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    creator_id uuid,
    sprint_number integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    parent_sprint_id uuid,
    auto_start boolean DEFAULT true NOT NULL,
    show_in_children boolean DEFAULT true NOT NULL,
    notify_on_start boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_task_policy_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid,
    review_required boolean NOT NULL,
    policy_version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_workflow_columns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    status public.status_task NOT NULL,
    title text NOT NULL,
    accent_class_name text NOT NULL,
    empty_title text NOT NULL,
    empty_description text NOT NULL,
    "position" integer NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.sprint_task_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sprint_id uuid NOT NULL,
    task_id uuid NOT NULL,
    added_by uuid,
    removed_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.task_activity_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sprint_id uuid
);
--> statement-breakpoint
CREATE TABLE public.task_comment_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_comment_id uuid,
    deleted_by uuid,
    deleted_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.task_pushes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    message text,
    files_count integer DEFAULT 0 NOT NULL,
    pushed_by uuid,
    pushed_at timestamp with time zone DEFAULT now() NOT NULL,
    files_json jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.task_read_receipts (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.task_subtasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    title text NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by uuid
);
--> statement-breakpoint
CREATE TABLE public.task_team_members (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_lead boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sprint_id uuid,
    assignee_id uuid,
    creator_id uuid,
    title text NOT NULL,
    description text,
    status public.status_task DEFAULT 'todo'::public.status_task NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    story_points integer,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    task_number integer,
    deleted_at timestamp with time zone,
    "position" double precision,
    workflow_column_id uuid,
    timeline_origin_sprint_id uuid,
    timeline_origin_at timestamp with time zone,
    review_status text DEFAULT 'none'::text NOT NULL,
    review_submitted_at timestamp with time zone,
    review_content_hash text,
    completed_at timestamp with time zone,
    completed_by uuid,
    completion_source text,
    kind text DEFAULT 'task'::text NOT NULL,
    assignment_id uuid,
    assignment_settings jsonb,
    submission jsonb,
    excused_at timestamp with time zone,
    excused_reason text,
    team_name text,
    CONSTRAINT tasks_completion_source_check CHECK ((completion_source = ANY (ARRAY['direct'::text, 'review'::text, 'legacy'::text]))),
    CONSTRAINT tasks_copy_is_task CHECK (((assignment_id IS NULL) OR (kind = 'task'::text))),
    CONSTRAINT tasks_excused_reason_length CHECK (((excused_reason IS NULL) OR (char_length(excused_reason) <= 500))),
    CONSTRAINT tasks_kind_check CHECK ((kind = ANY (ARRAY['task'::text, 'assignment'::text]))),
    CONSTRAINT tasks_team_name_length CHECK (((team_name IS NULL) OR (char_length(team_name) <= 60)))
);
--> statement-breakpoint
ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_activity_events
    ADD CONSTRAINT task_activity_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_comment_likes
    ADD CONSTRAINT task_comment_likes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_pushes
    ADD CONSTRAINT task_pushes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_read_receipts
    ADD CONSTRAINT task_read_receipts_pkey PRIMARY KEY (task_id, user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.task_team_members
    ADD CONSTRAINT task_team_members_pkey PRIMARY KEY (task_id, user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprint_events
    ADD CONSTRAINT workspace_sprint_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprints
    ADD CONSTRAINT workspace_sprints_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_task_policy_events
    ADD CONSTRAINT workspace_task_policy_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_workflow_columns
    ADD CONSTRAINT workspace_workflow_columns_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX comment_mentions_comment_idx ON public.comment_mentions USING btree (comment_id);
--> statement-breakpoint
CREATE UNIQUE INDEX comment_mentions_comment_user_unique ON public.comment_mentions USING btree (comment_id, mentioned_user_id);
--> statement-breakpoint
CREATE INDEX comment_mentions_user_created_idx ON public.comment_mentions USING btree (mentioned_user_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX project_sprints_project_id_id_key ON public.workspace_sprints USING btree (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_workflow_columns_project_id_id_key ON public.workspace_workflow_columns USING btree (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX sprint_task_memberships_active_task_idx ON public.sprint_task_memberships USING btree (task_id) WHERE (removed_at IS NULL);
--> statement-breakpoint
CREATE INDEX sprint_task_memberships_added_by_idx ON public.sprint_task_memberships USING btree (added_by);
--> statement-breakpoint
CREATE INDEX sprint_task_memberships_removed_by_idx ON public.sprint_task_memberships USING btree (removed_by);
--> statement-breakpoint
CREATE INDEX sprint_task_memberships_sprint_added_idx ON public.sprint_task_memberships USING btree (sprint_id, added_at, id);
--> statement-breakpoint
CREATE INDEX sprint_task_memberships_task_added_idx ON public.sprint_task_memberships USING btree (task_id, added_at DESC);
--> statement-breakpoint
CREATE INDEX sprint_task_memberships_workspace_id_idx ON public.sprint_task_memberships USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX task_activity_events_actor_idx ON public.task_activity_events USING btree (actor_id);
--> statement-breakpoint
CREATE INDEX task_activity_events_sprint_created_idx ON public.task_activity_events USING btree (workspace_id, sprint_id, created_at, id);
--> statement-breakpoint
CREATE INDEX task_activity_events_sprint_idx ON public.task_activity_events USING btree (sprint_id);
--> statement-breakpoint
CREATE INDEX task_activity_events_task_created_idx ON public.task_activity_events USING btree (task_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX task_activity_events_workspace_created_idx ON public.task_activity_events USING btree (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX task_comment_likes_comment_id_idx ON public.task_comment_likes USING btree (comment_id);
--> statement-breakpoint
CREATE UNIQUE INDEX task_comment_likes_unique ON public.task_comment_likes USING btree (comment_id, user_id);
--> statement-breakpoint
CREATE INDEX task_comment_likes_user_id_idx ON public.task_comment_likes USING btree (user_id);
--> statement-breakpoint
CREATE INDEX task_comments_created_at_idx ON public.task_comments USING btree (task_id, created_at);
--> statement-breakpoint
CREATE INDEX task_comments_deleted_by_idx ON public.task_comments USING btree (deleted_by);
--> statement-breakpoint
CREATE INDEX task_comments_parent_created_at_idx ON public.task_comments USING btree (parent_comment_id, created_at);
--> statement-breakpoint
CREATE INDEX task_comments_parent_id_idx ON public.task_comments USING btree (parent_comment_id);
--> statement-breakpoint
CREATE INDEX task_comments_task_created_active_idx ON public.task_comments USING btree (task_id, created_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX task_comments_task_id_idx ON public.task_comments USING btree (task_id);
--> statement-breakpoint
CREATE INDEX task_comments_user_id_idx ON public.task_comments USING btree (user_id);
--> statement-breakpoint
CREATE INDEX task_pushes_pushed_by_idx ON public.task_pushes USING btree (pushed_by);
--> statement-breakpoint
CREATE INDEX task_pushes_task_idx ON public.task_pushes USING btree (task_id);
--> statement-breakpoint
CREATE INDEX task_pushes_task_pushed_at_idx ON public.task_pushes USING btree (task_id, pushed_at DESC);
--> statement-breakpoint
CREATE INDEX task_pushes_workspace_idx ON public.task_pushes USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX task_read_receipts_user_task_idx ON public.task_read_receipts USING btree (user_id, task_id);
--> statement-breakpoint
CREATE INDEX task_subtasks_completed_by_idx ON public.task_subtasks USING btree (completed_by) WHERE (completed_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX task_subtasks_task_completed_idx ON public.task_subtasks USING btree (task_id, completed);
--> statement-breakpoint
CREATE INDEX task_subtasks_task_id_idx ON public.task_subtasks USING btree (task_id);
--> statement-breakpoint
CREATE INDEX task_team_members_user_idx ON public.task_team_members USING btree (user_id);
--> statement-breakpoint
CREATE INDEX tasks_active_workspace_status_position_idx ON public.tasks USING btree (workspace_id, status, "position" DESC, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX tasks_assignee_idx ON public.tasks USING btree (assignee_id);
--> statement-breakpoint
CREATE INDEX tasks_assignee_status_due_idx ON public.tasks USING btree (assignee_id, status, due_date);
--> statement-breakpoint
CREATE INDEX tasks_assignment_idx ON public.tasks USING btree (assignment_id) WHERE (assignment_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX tasks_completed_by_idx ON public.tasks USING btree (completed_by);
--> statement-breakpoint
CREATE INDEX tasks_creator_id_idx ON public.tasks USING btree (creator_id);
--> statement-breakpoint
CREATE INDEX tasks_deleted_at_partial_idx ON public.tasks USING btree (deleted_at) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX tasks_pending_review_idx ON public.tasks USING btree (workspace_id) WHERE ((review_status = 'pending'::text) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX tasks_project_id_id_key ON public.tasks USING btree (workspace_id, id);
--> statement-breakpoint
CREATE INDEX tasks_sprint_id_idx ON public.tasks USING btree (sprint_id);
--> statement-breakpoint
CREATE INDEX tasks_status_idx ON public.tasks USING btree (status);
--> statement-breakpoint
CREATE INDEX tasks_timeline_origin_sprint_idx ON public.tasks USING btree (timeline_origin_sprint_id, timeline_origin_at, id);
--> statement-breakpoint
CREATE INDEX tasks_title_search_idx ON public.tasks USING gin (title extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX tasks_workflow_column_idx ON public.tasks USING btree (workflow_column_id);
--> statement-breakpoint
CREATE INDEX tasks_workspace_assignee_idx ON public.tasks USING btree (workspace_id, assignee_id);
--> statement-breakpoint
CREATE INDEX tasks_workspace_idx ON public.tasks USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX tasks_workspace_number_idx ON public.tasks USING btree (workspace_id, task_number);
--> statement-breakpoint
CREATE INDEX tasks_workspace_sprint_idx ON public.tasks USING btree (workspace_id, sprint_id);
--> statement-breakpoint
CREATE INDEX tasks_workspace_status_idx ON public.tasks USING btree (workspace_id, status);
--> statement-breakpoint
CREATE INDEX tasks_workspace_updated_idx ON public.tasks USING btree (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_sprint_events_actor_idx ON public.workspace_sprint_events USING btree (actor_id);
--> statement-breakpoint
CREATE INDEX workspace_sprint_events_sprint_created_idx ON public.workspace_sprint_events USING btree (sprint_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_sprint_events_workspace_created_idx ON public.workspace_sprint_events USING btree (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_sprints_creator_idx ON public.workspace_sprints USING btree (creator_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_sprints_one_active_idx ON public.workspace_sprints USING btree (workspace_id) WHERE (status = 'active'::public.status_sprint);
--> statement-breakpoint
CREATE INDEX workspace_sprints_parent_idx ON public.workspace_sprints USING btree (parent_sprint_id) WHERE (parent_sprint_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_sprints_status_idx ON public.workspace_sprints USING btree (status);
--> statement-breakpoint
CREATE INDEX workspace_sprints_workspace_idx ON public.workspace_sprints USING btree (workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_sprints_workspace_number_idx ON public.workspace_sprints USING btree (workspace_id, sprint_number);
--> statement-breakpoint
CREATE INDEX workspace_sprints_workspace_updated_idx ON public.workspace_sprints USING btree (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_task_policy_events_actor_idx ON public.workspace_task_policy_events USING btree (actor_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_task_policy_events_version_idx ON public.workspace_task_policy_events USING btree (workspace_id, policy_version);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_workflow_columns_workspace_default_status_idx ON public.workspace_workflow_columns USING btree (workspace_id, status) WHERE (is_default = true);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_workflow_columns_workspace_position_idx ON public.workspace_workflow_columns USING btree (workspace_id, "position");
--> statement-breakpoint
CREATE TRIGGER task_comments_read_only_guard BEFORE INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER tasks_read_only_guard BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER workspaces_seed_workflow_columns AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_workflow_columns();
--> statement-breakpoint
ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_comment_id_task_comments_id_fk FOREIGN KEY (comment_id) REFERENCES public.task_comments(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_mentioned_user_id_profiles_id_fk FOREIGN KEY (mentioned_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.workspace_sprints(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_task_memberships
    ADD CONSTRAINT sprint_task_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_activity_events
    ADD CONSTRAINT task_activity_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_activity_events
    ADD CONSTRAINT task_activity_events_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.workspace_sprints(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_activity_events
    ADD CONSTRAINT task_activity_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_activity_events
    ADD CONSTRAINT task_activity_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comment_likes
    ADD CONSTRAINT task_comment_likes_comment_id_task_comments_id_fk FOREIGN KEY (comment_id) REFERENCES public.task_comments(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comment_likes
    ADD CONSTRAINT task_comment_likes_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.task_comments(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_pushes
    ADD CONSTRAINT task_pushes_pushed_by_fkey FOREIGN KEY (pushed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_pushes
    ADD CONSTRAINT task_pushes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_pushes
    ADD CONSTRAINT task_pushes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_read_receipts
    ADD CONSTRAINT task_read_receipts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_read_receipts
    ADD CONSTRAINT task_read_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_team_members
    ADD CONSTRAINT task_team_members_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.task_team_members
    ADD CONSTRAINT task_team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_profiles_id_fk FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_creator_id_profiles_id_fk FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_sprint_id_fkey FOREIGN KEY (workspace_id, sprint_id) REFERENCES public.workspace_sprints(workspace_id, id) ON DELETE SET NULL (sprint_id);
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_timeline_origin_sprint_id_fkey FOREIGN KEY (workspace_id, timeline_origin_sprint_id) REFERENCES public.workspace_sprints(workspace_id, id) ON DELETE SET NULL (timeline_origin_sprint_id);
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_workflow_column_id_fkey FOREIGN KEY (workspace_id, workflow_column_id) REFERENCES public.workspace_workflow_columns(workspace_id, id) ON DELETE SET NULL (workflow_column_id);
--> statement-breakpoint
ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprint_events
    ADD CONSTRAINT workspace_sprint_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprint_events
    ADD CONSTRAINT workspace_sprint_events_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.workspace_sprints(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprint_events
    ADD CONSTRAINT workspace_sprint_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprints
    ADD CONSTRAINT workspace_sprints_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprints
    ADD CONSTRAINT workspace_sprints_parent_sprint_id_fkey FOREIGN KEY (parent_sprint_id) REFERENCES public.workspace_sprints(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_sprints
    ADD CONSTRAINT workspace_sprints_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_task_policy_events
    ADD CONSTRAINT workspace_task_policy_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_task_policy_events
    ADD CONSTRAINT workspace_task_policy_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_workflow_columns
    ADD CONSTRAINT workspace_workflow_columns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY comment_mentions_insert_workspace_member ON public.comment_mentions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.task_comments tc
  WHERE ((tc.id = comment_mentions.comment_id) AND (tc.user_id = ( SELECT auth.uid() AS uid))))));
--> statement-breakpoint
CREATE POLICY comment_mentions_select_author_or_workspace_admin ON public.comment_mentions FOR SELECT USING (((mentioned_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM ((public.task_comments tc
     JOIN public.tasks t ON ((tc.task_id = t.id)))
     JOIN public.workspaces p ON ((t.workspace_id = p.id)))
  WHERE ((tc.id = comment_mentions.comment_id) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))))))));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.comment_mentions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.sprint_task_memberships TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_activity_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_comment_likes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_comments TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_pushes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_read_receipts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_subtasks TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.task_team_members TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.tasks TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_sprint_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_sprints TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_task_policy_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_workflow_columns TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.sprint_task_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_activity_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_comment_likes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_comment_likes_delete_own ON public.task_comment_likes FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY task_comment_likes_insert_own ON public.task_comment_likes FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY task_comment_likes_read ON public.task_comment_likes FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.task_comments tc
  WHERE ((tc.id = task_comment_likes.comment_id) AND (tc.deleted_at IS NULL) AND app_private.nb_task_visible(tc.task_id)))));
--> statement-breakpoint
CREATE POLICY task_comment_likes_update_own ON public.task_comment_likes FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_comments_delete_own ON public.task_comments FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY task_comments_insert_visible ON public.task_comments FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_comments.task_id) AND app_private.nb_workspace_can_read(t.workspace_id))))));
--> statement-breakpoint
CREATE POLICY task_comments_read ON public.task_comments FOR SELECT TO authenticated, anon USING (((deleted_at IS NULL) AND app_private.nb_task_visible(task_id)));
--> statement-breakpoint
CREATE POLICY task_comments_update_own ON public.task_comments FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_comments.task_id) AND app_private.nb_workspace_can_read(t.workspace_id))))));
--> statement-breakpoint
ALTER TABLE public.task_pushes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_read_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_subtasks_delete_workspace_writer ON public.task_subtasks FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_subtasks.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
CREATE POLICY task_subtasks_insert_workspace_writer ON public.task_subtasks FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_subtasks.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
CREATE POLICY task_subtasks_read ON public.task_subtasks FOR SELECT TO authenticated, anon USING (app_private.nb_task_visible(task_id));
--> statement-breakpoint
CREATE POLICY task_subtasks_update_workspace_writer ON public.task_subtasks FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_subtasks.task_id) AND app_private.nb_workspace_can_write(t.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_subtasks.task_id) AND app_private.nb_workspace_can_write(t.workspace_id)))));
--> statement-breakpoint
ALTER TABLE public.task_team_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tasks_delete_workspace_writer ON public.tasks FOR DELETE TO authenticated USING (((deleted_at IS NULL) AND app_private.nb_workspace_can_write(workspace_id)));
--> statement-breakpoint
CREATE POLICY tasks_insert_workspace_writer ON public.tasks FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated, anon USING (app_private.nb_task_visible(id));
--> statement-breakpoint
CREATE POLICY tasks_update_workspace_writer ON public.tasks FOR UPDATE TO authenticated USING (((deleted_at IS NULL) AND app_private.nb_workspace_can_write(workspace_id))) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_sprint_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_sprints_delete_workspace_writer ON public.workspace_sprints FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_sprints_insert_workspace_writer ON public.workspace_sprints FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_sprints_select_visible ON public.workspace_sprints FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_sprints_update_workspace_writer ON public.workspace_sprints FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_task_policy_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_workflow_columns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_workflow_columns_read ON public.workspace_workflow_columns FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_tab_visible(workspace_id, 'tasks'::text));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_task_visible(p_task_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_task_visible(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_task_visible(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_task_visible(p_task_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_task_visible(p_task_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.seed_workspace_workflow_columns() FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_workspace_workflow_columns() TO service_role;
GRANT ALL ON FUNCTION public.seed_workspace_workflow_columns() TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.comment_mentions TO anon;
GRANT MAINTAIN ON TABLE public.comment_mentions TO authenticated;
GRANT ALL ON TABLE public.comment_mentions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.comment_mentions TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_sprint_events TO anon;
GRANT MAINTAIN ON TABLE public.workspace_sprint_events TO authenticated;
GRANT ALL ON TABLE public.workspace_sprint_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_sprint_events TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_sprints TO anon;
GRANT MAINTAIN ON TABLE public.workspace_sprints TO authenticated;
GRANT ALL ON TABLE public.workspace_sprints TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_sprints TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_task_policy_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_task_policy_events TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_workflow_columns TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_workflow_columns TO authenticated;
GRANT ALL ON TABLE public.workspace_workflow_columns TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_workflow_columns TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.sprint_task_memberships TO anon;
GRANT MAINTAIN ON TABLE public.sprint_task_memberships TO authenticated;
GRANT ALL ON TABLE public.sprint_task_memberships TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sprint_task_memberships TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.task_activity_events TO anon;
GRANT MAINTAIN ON TABLE public.task_activity_events TO authenticated;
GRANT ALL ON TABLE public.task_activity_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_activity_events TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.task_comment_likes TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.task_comment_likes TO authenticated;
GRANT ALL ON TABLE public.task_comment_likes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_comment_likes TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.task_comments TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.task_comments TO authenticated;
GRANT ALL ON TABLE public.task_comments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_comments TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.task_pushes TO anon;
GRANT MAINTAIN ON TABLE public.task_pushes TO authenticated;
GRANT ALL ON TABLE public.task_pushes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_pushes TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.task_read_receipts TO anon;
GRANT MAINTAIN ON TABLE public.task_read_receipts TO authenticated;
GRANT ALL ON TABLE public.task_read_receipts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_read_receipts TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.task_subtasks TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.task_subtasks TO authenticated;
GRANT ALL ON TABLE public.task_subtasks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_subtasks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.task_team_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_team_members TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.tasks TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tasks TO nb_app;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comment_likes;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_subtasks;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_workflow_columns;
