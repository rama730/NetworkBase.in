-- Workspace documents, versions, opens, sprint materials.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_document_versions v
    JOIN public.workspace_documents d
      ON d.id = v.doc_id
     AND d.published_version_id = v.id
    WHERE v.id = p_version_id
      AND v.deleted_at IS NULL
      AND COALESCE(d.settings ->> 'visibilityOverride', 'inherit_workspace') IN ('inherit_workspace', 'public')
      AND app_private.nb_workspace_public_doc_visible(v.workspace_id)
  );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND (coalesce(p_settings ->> 'visibilityOverride', 'inherit_workspace') <> 'leaders_only'
                 OR pm.role IN ('owner', 'admin'))
        )
      )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
      AND coalesce(p.status::text, 'draft') <> 'draft'
      AND COALESCE(p.public_tab_visibility ->> 'readme', 'true') = 'true'
  );
$$;
--> statement-breakpoint
CREATE TABLE public.doc_opens (
    doc_id uuid NOT NULL,
    user_id uuid NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    version_number integer NOT NULL,
    content text NOT NULL,
    excerpt text,
    headings jsonb DEFAULT '[]'::jsonb NOT NULL,
    quality_report jsonb DEFAULT '{"score": 0, "issues": [], "contentBytes": 0, "sectionPresence": {}}'::jsonb NOT NULL,
    content_hash text NOT NULL,
    change_summary text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    co_authors jsonb DEFAULT '[]'::jsonb NOT NULL,
    doc_id uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    published_version_id uuid,
    settings jsonb DEFAULT '{"version": 1, "editPolicy": "leaders", "projectBlocks": true, "externalImages": false, "visibilityOverride": "inherit_workspace"}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_node_id uuid,
    filename text DEFAULT 'README.md'::text NOT NULL,
    slug text DEFAULT 'readme'::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.sprint_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sprint_id uuid NOT NULL,
    node_id uuid,
    doc_id uuid,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sprint_materials_one_target CHECK (((node_id IS NULL) <> (doc_id IS NULL)))
);
--> statement-breakpoint
ALTER TABLE ONLY public.doc_opens
    ADD CONSTRAINT doc_opens_pkey PRIMARY KEY (doc_id, user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_materials
    ADD CONSTRAINT sprint_materials_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_document_versions
    ADD CONSTRAINT workspace_document_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_documents
    ADD CONSTRAINT workspace_documents_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX doc_opens_user_idx ON public.doc_opens USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_doc_versions_doc_id_id_key ON public.workspace_document_versions USING btree (doc_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_docs_project_id_id_key ON public.workspace_documents USING btree (workspace_id, id);
--> statement-breakpoint
CREATE INDEX sprint_materials_added_by_idx ON public.sprint_materials USING btree (added_by) WHERE (added_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX sprint_materials_doc_idx ON public.sprint_materials USING btree (doc_id) WHERE (doc_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX sprint_materials_doc_unique ON public.sprint_materials USING btree (sprint_id, doc_id) WHERE (doc_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX sprint_materials_node_idx ON public.sprint_materials USING btree (node_id) WHERE (node_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX sprint_materials_node_unique ON public.sprint_materials USING btree (sprint_id, node_id) WHERE (node_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX sprint_materials_sprint_idx ON public.sprint_materials USING btree (sprint_id);
--> statement-breakpoint
CREATE INDEX workspace_document_versions_created_by_idx ON public.workspace_document_versions USING btree (created_by);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_document_versions_doc_id_version_number_key ON public.workspace_document_versions USING btree (doc_id, version_number);
--> statement-breakpoint
CREATE INDEX workspace_document_versions_workspace_deleted_idx ON public.workspace_document_versions USING btree (workspace_id, deleted_at);
--> statement-breakpoint
CREATE INDEX workspace_documents_linked_node_idx ON public.workspace_documents USING btree (linked_node_id);
--> statement-breakpoint
CREATE INDEX workspace_documents_published_version_idx ON public.workspace_documents USING btree (published_version_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_documents_slug_unique ON public.workspace_documents USING btree (workspace_id, slug);
--> statement-breakpoint
CREATE INDEX workspace_documents_workspace_idx ON public.workspace_documents USING btree (workspace_id);
--> statement-breakpoint
ALTER TABLE ONLY public.doc_opens
    ADD CONSTRAINT doc_opens_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.workspace_documents(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.doc_opens
    ADD CONSTRAINT doc_opens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_materials
    ADD CONSTRAINT sprint_materials_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_materials
    ADD CONSTRAINT sprint_materials_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.workspace_documents(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_materials
    ADD CONSTRAINT sprint_materials_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.workspace_nodes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.sprint_materials
    ADD CONSTRAINT sprint_materials_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.workspace_sprints(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_document_versions
    ADD CONSTRAINT workspace_document_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_document_versions
    ADD CONSTRAINT workspace_document_versions_workspace_id_doc_id_fkey FOREIGN KEY (workspace_id, doc_id) REFERENCES public.workspace_documents(workspace_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_document_versions
    ADD CONSTRAINT workspace_document_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_documents
    ADD CONSTRAINT workspace_documents_id_published_version_id_fkey FOREIGN KEY (id, published_version_id) REFERENCES public.workspace_document_versions(doc_id, id) ON DELETE SET NULL (published_version_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_documents
    ADD CONSTRAINT workspace_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_documents
    ADD CONSTRAINT workspace_documents_workspace_id_linked_node_id_fkey FOREIGN KEY (workspace_id, linked_node_id) REFERENCES public.workspace_nodes(workspace_id, id) ON DELETE SET NULL (linked_node_id);
--> statement-breakpoint
ALTER TABLE public.doc_opens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.doc_opens TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.sprint_materials TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_document_versions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_documents TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.sprint_materials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_document_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_document_versions_delete_workspace_writer ON public.workspace_document_versions FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_document_versions_insert_workspace_writer ON public.workspace_document_versions FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_document_versions_read ON public.workspace_document_versions FOR SELECT TO authenticated, anon USING (((EXISTS ( SELECT 1
   FROM public.workspace_documents doc
  WHERE ((doc.id = workspace_document_versions.doc_id) AND (doc.workspace_id = workspace_document_versions.workspace_id) AND app_private.nb_workspace_doc_member_can_read(doc.workspace_id, doc.settings)))) OR app_private.nb_doc_version_is_public(id)));
--> statement-breakpoint
CREATE POLICY workspace_document_versions_update_workspace_writer ON public.workspace_document_versions FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_documents_delete_workspace_writer ON public.workspace_documents FOR DELETE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_documents_insert_workspace_writer ON public.workspace_documents FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_documents_read ON public.workspace_documents FOR SELECT TO authenticated, anon USING ((app_private.nb_workspace_doc_member_can_read(workspace_id, settings) OR ((published_version_id IS NOT NULL) AND (COALESCE((settings ->> 'visibilityOverride'::text), 'inherit_workspace'::text) = ANY (ARRAY['inherit_workspace'::text, 'public'::text])) AND app_private.nb_workspace_public_doc_visible(workspace_id))));
--> statement-breakpoint
CREATE POLICY workspace_documents_update_workspace_writer ON public.workspace_documents FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_write(workspace_id)) WITH CHECK (app_private.nb_workspace_can_write(workspace_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_doc_version_is_public(p_version_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_doc_member_can_read(p_project_id uuid, p_settings jsonb) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_public_doc_visible(p_project_id uuid) TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.doc_opens TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.doc_opens TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_document_versions TO anon;
GRANT MAINTAIN ON TABLE public.workspace_document_versions TO authenticated;
GRANT ALL ON TABLE public.workspace_document_versions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_document_versions TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_documents TO anon;
GRANT MAINTAIN ON TABLE public.workspace_documents TO authenticated;
GRANT ALL ON TABLE public.workspace_documents TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_documents TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.sprint_materials TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sprint_materials TO nb_app;
