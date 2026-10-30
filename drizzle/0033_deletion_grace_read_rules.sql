-- During the 30-day deletion grace only the owner may open a workspace or organization, as the app already enforces; the database read rules did not.
CREATE OR REPLACE FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (p.deletion_scheduled_at IS NULL OR p.owner_id = (SELECT auth.uid()))
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (p.visibility IN ('public', 'unlisted') AND coalesce(p.status::text, 'draft') <> 'draft')
        OR (p.parent_id IS NOT NULL AND (
          app_private.nb_org_role(p.parent_id) IN ('owner', 'admin')
          OR (p.visibility = 'org' AND coalesce(p.status::text, 'draft') <> 'draft' AND app_private.nb_org_role(p.parent_id) IS NOT NULL)
        ))
      )
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (p.deletion_scheduled_at IS NULL OR p.owner_id = (SELECT auth.uid()))
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid()))
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
        OR (
          coalesce(p.status::text, 'draft') <> 'draft'
          AND (p.visibility IN ('public', 'unlisted')
               OR (p.visibility = 'org' AND p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IS NOT NULL))
          AND coalesce(p.public_tab_visibility ->> p_tab, CASE WHEN p_tab IN ('tasks', 'sprints') THEN 'false' ELSE 'true' END) = 'true'
        )
      )
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_org_role(p_org_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN o.owner_id = (SELECT auth.uid()) THEN 'owner' ELSE pm.role END
  FROM public.workspaces o
  LEFT JOIN public.workspace_members pm ON pm.workspace_id = o.id AND pm.user_id = (SELECT auth.uid())
  WHERE o.id = p_org_id AND o.kind = 'organization' AND o.deleted_at IS NULL AND (o.deletion_scheduled_at IS NULL OR o.owner_id = (SELECT auth.uid()));
$$;
