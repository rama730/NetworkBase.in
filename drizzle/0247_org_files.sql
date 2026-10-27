-- 0247_org_files.sql
-- Org Files (docs/organization-concept-report.md §23): folder access levels and private assignment copies.
-- Folders in an organization carry metadata.access = 'admins' | 'members' | 'public' (unset = members),
-- inherited down the tree and only ever stricter (§23.3). Task-owned files on assignment copies are visible
-- only to the people on the copy and the admins (§23.5). Mirrors src/lib/organizations/file-rules.ts and
-- orgFileAccessSql in src/lib/files/internal-helpers.ts. Other projects are unchanged.

CREATE INDEX project_nodes_access_folders_idx ON public.project_nodes (project_id, path)
  WHERE type = 'folder' AND deleted_at IS NULL AND metadata ? 'access';

--> statement-breakpoint

CREATE FUNCTION app_private.nb_org_node_access_ok(p_project_id uuid, p_task_id uuid, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    -- Owners and admins see the whole tree and every copy.
    WHEN EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = p_project_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin')
      THEN true
    ELSE
      (p_task_id IS NULL OR app_private.nb_task_visible(p_task_id))
      AND NOT EXISTS (
        SELECT 1 FROM public.project_nodes f
        WHERE f.project_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
          AND f.metadata->>'access' = 'admins'
          AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
      )
      AND (
        -- Members and guests read everything but Admins-only; visitors only under Public folders.
        EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = p_project_id AND m.user_id = (SELECT auth.uid()))
        OR (
          EXISTS (
            SELECT 1 FROM public.project_nodes f
            WHERE f.project_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'public'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.project_nodes f
            WHERE f.project_id = p_project_id AND f.type = 'folder' AND f.deleted_at IS NULL
              AND f.metadata->>'access' = 'members'
              AND (p_path = f.path OR starts_with(p_path, f.path || '/'))
          )
        )
      )
  END;
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_org_node_access_ok(uuid, uuid, text) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app_private.nb_org_node_access_ok(uuid, uuid, text) TO anon, authenticated, service_role;

--> statement-breakpoint

-- Same body as 0178, plus the org rule for organization projects.
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
      AND (project.kind <> 'organization' OR app_private.nb_org_node_access_ok(p_project_id, p_task_id, p_path))
  );
$$;
