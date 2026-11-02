-- Report §42.2 problem 1 and §42.4 "who can see an assignment": one rule for every reader. In an organization,
-- members see published main assignments and their own (or their team's) copies; owners and admins see all.
-- Drafts were visible to members before. nb_task_visible (RLS, files) calls this with auth.uid(); the server
-- calls it with the viewer's id where it builds SQL by hand (chat cards, the editor extension, comments).
CREATE FUNCTION app_private.nb_org_task_visible_to(p_task_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.workspaces p ON p.id = t.workspace_id
    WHERE t.id = p_task_id
      AND (
        p.kind <> 'organization'
        OR p.owner_id = p_user_id
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p.id AND pm.user_id = p_user_id AND pm.role = 'admin')
        OR (t.kind = 'assignment' AND t.assignment_id IS NULL AND t.assignment_settings->>'publishedAt' IS NOT NULL)
        OR t.assignee_id = p_user_id
        OR EXISTS (SELECT 1 FROM public.task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = p_user_id)
      )
  );
$$;
--> statement-breakpoint
-- Asking about someone else is for the server only.
REVOKE ALL ON FUNCTION app_private.nb_org_task_visible_to(p_task_id uuid, p_user_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_org_task_visible_to(p_task_id uuid, p_user_id uuid) TO service_role;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_org_task_visible_to(p_task_id uuid, p_user_id uuid) TO nb_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_task_visible(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.deleted_at IS NULL
      AND app_private.nb_workspace_tab_visible(t.workspace_id, 'tasks')
      AND app_private.nb_org_task_visible_to(t.id, (SELECT auth.uid()))
  );
$$;
