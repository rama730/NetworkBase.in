-- Plan B1.3c (report 30.9 views and call: section news): an announcement's audience can name sections of a class.
-- The database's audience rule learns them, so it keeps matching the app's rule (update-rules.ts audienceAllows).

CREATE OR REPLACE FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_audience IS NULL OR p_audience = '{}'::jsonb
    OR p_author_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspaces p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.workspace_members pm
      WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid())
        AND (pm.role = 'admin' OR p_audience->'roles' @> to_jsonb(pm.role))
    )
    OR (p_audience->'projectIds' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.workspace_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.workspace_id::text IN (SELECT jsonb_array_elements_text(p_audience->'projectIds'))
    ))
    OR (p_audience->'sectionIds' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.class_section_members sm
      WHERE sm.user_id = (SELECT auth.uid()) AND sm.workspace_id = p_project_id
        AND sm.section_id::text IN (SELECT jsonb_array_elements_text(p_audience->'sectionIds'))
    ));
$$;
