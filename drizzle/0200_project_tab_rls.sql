-- RLS-007: one project readability rule (deleted, draft, visibility) and one
-- per-tab rule, matching src/lib/data/project-access.ts canReadProjectTab.
-- RLS-010: deleted updates and their comments are not public.
CREATE OR REPLACE FUNCTION app_private.nb_project_can_read(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (p.visibility IN ('public', 'unlisted') AND coalesce(p.status::text, 'draft') <> 'draft')
      )
  );
$$;
--> statement-breakpoint
-- Owners and members see every tab; others need a readable project and the tab
-- switched on (defaults: dashboard, readme, updates, files on; tasks, sprints off).
CREATE OR REPLACE FUNCTION app_private.nb_project_tab_visible(p_project_id uuid, p_tab text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (
          p.visibility IN ('public', 'unlisted')
          AND coalesce(p.status::text, 'draft') <> 'draft'
          AND coalesce(p.public_tab_visibility ->> p_tab, CASE WHEN p_tab IN ('tasks', 'sprints') THEN 'false' ELSE 'true' END) = 'true'
        )
      )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_project_tab_visible(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_project_tab_visible(uuid, text) TO anon, authenticated, service_role;
--> statement-breakpoint
DROP POLICY IF EXISTS projects_select_visible ON public.projects;
--> statement-breakpoint
CREATE POLICY projects_read ON public.projects FOR SELECT TO anon, authenticated
  USING (app_private.nb_project_can_read(id));
--> statement-breakpoint
DROP POLICY IF EXISTS tasks_select_visible ON public.tasks;
--> statement-breakpoint
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND app_private.nb_project_tab_visible(project_id, 'tasks'));
--> statement-breakpoint
DROP POLICY IF EXISTS task_subtasks_select_visible ON public.task_subtasks;
--> statement-breakpoint
CREATE POLICY task_subtasks_read ON public.task_subtasks FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_subtasks.task_id AND t.deleted_at IS NULL
                 AND app_private.nb_project_tab_visible(t.project_id, 'tasks')));
--> statement-breakpoint
DROP POLICY IF EXISTS task_comments_select_visible ON public.task_comments;
--> statement-breakpoint
CREATE POLICY task_comments_read ON public.task_comments FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_comments.task_id AND t.deleted_at IS NULL
                                        AND app_private.nb_project_tab_visible(t.project_id, 'tasks')));
--> statement-breakpoint
DROP POLICY IF EXISTS task_comment_likes_select_visible ON public.task_comment_likes;
--> statement-breakpoint
CREATE POLICY task_comment_likes_read ON public.task_comment_likes FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.task_comments tc JOIN public.tasks t ON t.id = tc.task_id
                 WHERE tc.id = task_comment_likes.comment_id AND tc.deleted_at IS NULL AND t.deleted_at IS NULL
                   AND app_private.nb_project_tab_visible(t.project_id, 'tasks')));
--> statement-breakpoint
DROP POLICY IF EXISTS task_node_links_select_visible ON public.task_node_links;
--> statement-breakpoint
CREATE POLICY task_node_links_read ON public.task_node_links FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_node_links.task_id AND t.deleted_at IS NULL
                 AND app_private.nb_project_tab_visible(t.project_id, 'tasks')));
--> statement-breakpoint
DROP POLICY IF EXISTS project_workflow_columns_select_visible ON public.project_workflow_columns;
--> statement-breakpoint
CREATE POLICY project_workflow_columns_read ON public.project_workflow_columns FOR SELECT TO anon, authenticated
  USING (app_private.nb_project_tab_visible(project_id, 'tasks'));
--> statement-breakpoint
-- Updates: the author keeps their own deleted update (restore); everyone else
-- needs a live update, a public update for non-members, and the Updates tab.
DROP POLICY IF EXISTS project_updates_select_visible ON public.project_updates;
--> statement-breakpoint
CREATE POLICY project_updates_read ON public.project_updates FOR SELECT TO anon, authenticated
  USING (
    (deleted_at IS NULL OR author_id = (SELECT auth.uid()))
    AND app_private.nb_project_tab_visible(project_id, 'updates')
    AND (visibility = 'public' OR app_private.nb_project_can_write(project_id)
         OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_updates.project_id AND pm.user_id = (SELECT auth.uid())))
  );
--> statement-breakpoint
DROP POLICY IF EXISTS project_update_comments_select_visible ON public.project_update_comments;
--> statement-breakpoint
CREATE POLICY project_update_comments_read ON public.project_update_comments FOR SELECT TO anon, authenticated
  USING (
    (deleted_at IS NULL OR user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.project_updates u WHERE u.id = project_update_comments.update_id)
  );

--> statement-breakpoint
-- Realtime: task presence follows Tasks visibility, like the task tables.
ALTER POLICY application_topic_read ON realtime.messages USING (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND app_private.nb_can_observe_user_presence((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_project_tab_visible(task.project_id, 'tasks')))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_project_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text))
    ELSE false
END);
--> statement-breakpoint
ALTER POLICY application_topic_send ON realtime.messages WITH CHECK (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_project_tab_visible(task.project_id, 'tasks')))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_project_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN false
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    ELSE false
END);
