-- P0 Data API visibility (RLS-001..004). One SELECT rule per object; browser
-- roles never write connection state.

-- RLS-001: the renamed pre-hardening policies OR-combined with the canonical
-- nb_project_node_can_read policies and re-opened drafts, hidden tabs, /.system
-- and trashed nodes. Only *_read remains.
DROP POLICY IF EXISTS project_nodes_select_visible ON public.project_nodes;
--> statement-breakpoint
DROP POLICY IF EXISTS file_versions_select_visible ON public.file_versions;
--> statement-breakpoint

-- RLS-003: indexed content is readable exactly where its node is.
DROP POLICY IF EXISTS project_file_index_select_visible ON public.project_file_index;
--> statement-breakpoint
CREATE POLICY project_file_index_read ON public.project_file_index
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_nodes node
    WHERE node.id = project_file_index.node_id
      AND node.project_id = project_file_index.project_id
      AND app_private.nb_project_node_can_read(node.project_id, node.task_id, node.path, node.deleted_at)
  ));
--> statement-breakpoint

-- RLS-002: public documents only on non-draft public projects with the Readme tab.
CREATE OR REPLACE FUNCTION app_private.nb_project_public_doc_visible(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
      AND coalesce(p.status::text, 'draft') <> 'draft'
      AND COALESCE(p.public_tab_visibility ->> 'readme', 'true') = 'true'
  );
$$;
--> statement-breakpoint

-- Owner/members read a doc and its history unless it is leaders-only, which
-- only the owner and admins read (mirrors resolveProjectDocPermission).
CREATE OR REPLACE FUNCTION app_private.nb_project_doc_member_can_read(p_project_id uuid, p_settings jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND (coalesce(p_settings ->> 'visibilityOverride', 'inherit_project') <> 'leaders_only'
                 OR pm.role IN ('owner', 'admin'))
        )
      )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_project_doc_member_can_read(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_project_doc_member_can_read(uuid, jsonb) TO anon, authenticated, service_role;
--> statement-breakpoint

DROP POLICY IF EXISTS project_docs_select_visible ON public.project_docs;
--> statement-breakpoint
CREATE POLICY project_docs_read ON public.project_docs
  FOR SELECT TO anon, authenticated
  USING (
    app_private.nb_project_doc_member_can_read(project_id, settings)
    OR (
      published_version_id IS NOT NULL
      AND coalesce(settings ->> 'visibilityOverride', 'inherit_project') IN ('inherit_project', 'public')
      AND app_private.nb_project_public_doc_visible(project_id)
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS project_doc_versions_select_visible ON public.project_doc_versions;
--> statement-breakpoint
CREATE POLICY project_doc_versions_read ON public.project_doc_versions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_docs doc
      WHERE doc.id = project_doc_versions.markdown_id
        AND doc.project_id = project_doc_versions.project_id
        AND app_private.nb_project_doc_member_can_read(doc.project_id, doc.settings)
    )
    OR app_private.nb_doc_version_is_public(id)
  );
--> statement-breakpoint

-- RLS-004: requests, acceptance, rejection and blocking are server commands
-- (src/app/actions/connections.ts); participants keep read access.
DROP POLICY IF EXISTS connections_insert_own ON public.connections;
--> statement-breakpoint
DROP POLICY IF EXISTS connections_update_own ON public.connections;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.connections FROM anon, authenticated;
