-- 0244_org_assignments.sql
-- Assignments (docs/organization-concept-report.md §16, §16.11): a master task (kind = 'assignment') and one
-- copy per person, per team or per child project (assignment_id -> master). Missing and Late are derived
-- from dates, never stored. Read rule (decision 19): in an organization, members see the masters, their own
-- copies and their team's copies; owners and admins see everything. Mirrors src/lib/organizations/assignments.ts.

ALTER TABLE public.tasks
  ADD COLUMN kind text NOT NULL DEFAULT 'task',
  ADD COLUMN assignment_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN assignment_settings jsonb,
  ADD COLUMN submission jsonb,
  ADD COLUMN excused_at timestamptz,
  ADD COLUMN excused_reason text,
  ADD COLUMN team_name text,
  ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('task', 'assignment')),
  ADD CONSTRAINT tasks_copy_is_task CHECK (assignment_id IS NULL OR kind = 'task'),
  ADD CONSTRAINT tasks_excused_reason_length CHECK (excused_reason IS NULL OR char_length(excused_reason) <= 500),
  ADD CONSTRAINT tasks_team_name_length CHECK (team_name IS NULL OR char_length(team_name) <= 60);

--> statement-breakpoint

CREATE INDEX tasks_assignment_idx ON public.tasks(assignment_id) WHERE assignment_id IS NOT NULL;

--> statement-breakpoint

-- A team copy's people; the copy's assignee_id stays the team lead so "assigned to me" keeps working.
CREATE TABLE public.task_team_members (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

--> statement-breakpoint

CREATE INDEX task_team_members_user_idx ON public.task_team_members(user_id);

--> statement-breakpoint

ALTER TABLE public.task_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_team_members FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_team_members TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.task_team_members TO service_role;
  END IF;
END $$;

--> statement-breakpoint

-- One row rule for every task-scoped read: the Tasks tab, plus the org rule above.
CREATE FUNCTION app_private.nb_task_visible(p_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND app_private.nb_project_tab_visible(t.project_id, 'tasks')
      AND (
        p.kind <> 'organization'
        OR p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p.id AND pm.user_id = (SELECT auth.uid()) AND pm.role = 'admin')
        OR (t.kind = 'assignment' AND t.assignment_id IS NULL)
        OR t.assignee_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = (SELECT auth.uid()))
      )
  );
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_task_visible(uuid) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app_private.nb_task_visible(uuid) TO anon, authenticated, service_role;

--> statement-breakpoint

DROP POLICY IF EXISTS tasks_read ON public.tasks;

--> statement-breakpoint

CREATE POLICY tasks_read ON public.tasks FOR SELECT TO anon, authenticated
  USING (app_private.nb_task_visible(id));

--> statement-breakpoint

DROP POLICY IF EXISTS task_subtasks_read ON public.task_subtasks;

--> statement-breakpoint

CREATE POLICY task_subtasks_read ON public.task_subtasks FOR SELECT TO anon, authenticated
  USING (app_private.nb_task_visible(task_id));

--> statement-breakpoint

DROP POLICY IF EXISTS task_comments_read ON public.task_comments;

--> statement-breakpoint

-- Copy comments stay between the person (or team) and the admins; master comments are the shared Q&A.
CREATE POLICY task_comments_read ON public.task_comments FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND app_private.nb_task_visible(task_id));

--> statement-breakpoint

DROP POLICY IF EXISTS task_comment_likes_read ON public.task_comment_likes;

--> statement-breakpoint

CREATE POLICY task_comment_likes_read ON public.task_comment_likes FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.task_comments tc WHERE tc.id = task_comment_likes.comment_id AND tc.deleted_at IS NULL
                 AND app_private.nb_task_visible(tc.task_id)));

--> statement-breakpoint

DROP POLICY IF EXISTS task_node_links_read ON public.task_node_links;

--> statement-breakpoint

CREATE POLICY task_node_links_read ON public.task_node_links FOR SELECT TO anon, authenticated
  USING (app_private.nb_task_visible(task_id));
