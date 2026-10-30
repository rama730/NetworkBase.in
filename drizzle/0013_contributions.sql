-- Profile contributions, stages, drafts, media, skills, collaboration summaries.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION public.record_file_content_contribution() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  project_uuid uuid;
  actor uuid := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
BEGIN
  IF current_setting('app.maintenance_operation', true) IN ('hash_backfill', 'version_repair') THEN
    RETURN NEW;
  END IF;
  IF actor IS NOT NULL AND (NEW.uploaded_by IS DISTINCT FROM actor OR NEW.attribution <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'File authorship must match the authenticated actor';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.s3_key IS NOT DISTINCT FROM OLD.s3_key
    AND NEW.size IS NOT DISTINCT FROM OLD.size
    AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.file_versions previous WHERE previous.node_id=NEW.node_id
      AND previous.version=NEW.version-1 AND previous.content_hash=NEW.content_hash
  ) THEN RETURN NEW; END IF;
  SELECT workspace_id INTO project_uuid FROM public.workspace_nodes WHERE id = NEW.node_id;
  INSERT INTO public.workspace_node_events(workspace_id,node_id,actor_id,type,sequence_number,metadata)
  VALUES (project_uuid,NEW.node_id,NEW.uploaded_by,'file_content_contributed',0,
    jsonb_build_object('version',NEW.version,'hash',NEW.content_hash,'source',COALESCE(NEW.attribution->>'source','edge'),'attribution',NEW.attribution));
  IF NEW.uploaded_by IS NOT NULL THEN
    UPDATE public.profile_collaboration_summaries SET stale=true,updated_at=now() WHERE profile_id=NEW.uploaded_by;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE public.profile_collaboration_summaries (
    profile_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    summary jsonb DEFAULT '{"stats": {"projectsCount": 0, "contributionCount": 0, "visibleProjectsCount": 0}, "version": 1, "projects": [], "generatedAt": "", "contributions": [], "featuredProjects": []}'::jsonb NOT NULL,
    workspace_count integer DEFAULT 0 NOT NULL,
    visible_workspace_count integer DEFAULT 0 NOT NULL,
    contribution_count integer DEFAULT 0 NOT NULL,
    stale boolean DEFAULT false NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profile_contribution_drafts (
    contribution_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profile_contribution_drafts_document_check CHECK ((octet_length((document)::text) <= 150000))
);
--> statement-breakpoint
CREATE TABLE public.profile_contribution_media_assets (
    contribution_id uuid NOT NULL,
    asset_id uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profile_contribution_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contribution_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.profile_contribution_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contribution_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    workspace_id uuid,
    source text DEFAULT 'membership'::text NOT NULL,
    role_kind text DEFAULT 'contributor'::text NOT NULL,
    role_title text,
    summary text,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    verified_at timestamp with time zone,
    verified_by uuid,
    event_id uuid,
    visibility text DEFAULT 'public'::text NOT NULL,
    manual_override boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT profile_contribution_stages_role_kind_check CHECK ((role_kind = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text, 'contributor'::text]))),
    CONSTRAINT profile_contribution_stages_source_check CHECK ((source = ANY (ARRAY['membership'::text, 'application'::text, 'owner'::text, 'manual'::text, 'role_change'::text, 'workspace_invite'::text, 'ownership_transfer'::text, 'removal'::text, 'backfill'::text]))),
    CONSTRAINT profile_contribution_stages_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);
--> statement-breakpoint
CREATE TABLE public.profile_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    workspace_id uuid,
    source text DEFAULT 'membership'::text NOT NULL,
    role_kind text DEFAULT 'contributor'::text NOT NULL,
    role_title text,
    summary text,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    verified_at timestamp with time zone,
    verified_by uuid,
    visibility text DEFAULT 'public'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    external_key text,
    project_title text,
    project_url text,
    repository_url text,
    version integer DEFAULT 1 NOT NULL,
    presentation jsonb,
    featured boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    verification_revoked_reason text,
    show_work_record boolean DEFAULT false NOT NULL,
    CONSTRAINT profile_contribution_presentation_size CHECK (((presentation IS NULL) OR (octet_length((presentation)::text) <= 150000))),
    CONSTRAINT profile_contributions_authority_shape_check CHECK ((((workspace_id IS NOT NULL) AND (external_key IS NULL)) OR ((workspace_id IS NULL) AND (external_key IS NOT NULL) AND (NULLIF(btrim(project_title), ''::text) IS NOT NULL)))),
    CONSTRAINT profile_contributions_revoked_reason_length CHECK (((verification_revoked_reason IS NULL) OR (char_length(verification_revoked_reason) <= 500))),
    CONSTRAINT profile_contributions_role_kind_check CHECK ((role_kind = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text, 'contributor'::text]))),
    CONSTRAINT profile_contributions_source_check CHECK ((source = ANY (ARRAY['membership'::text, 'application'::text, 'owner'::text, 'manual'::text]))),
    CONSTRAINT profile_contributions_version_check CHECK ((version > 0)),
    CONSTRAINT profile_contributions_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_collaboration_summaries
    ADD CONSTRAINT profile_collaboration_summaries_pkey PRIMARY KEY (profile_id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_drafts
    ADD CONSTRAINT profile_contribution_drafts_pkey PRIMARY KEY (contribution_id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_media_assets
    ADD CONSTRAINT profile_contribution_media_assets_pkey PRIMARY KEY (contribution_id, asset_id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_skills
    ADD CONSTRAINT profile_contribution_skills_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_skills
    ADD CONSTRAINT profile_contribution_skills_unique UNIQUE (contribution_id, skill_id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_stages
    ADD CONSTRAINT profile_contribution_stages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contributions
    ADD CONSTRAINT profile_contributions_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX profile_collaboration_summaries_refreshed_idx ON public.profile_collaboration_summaries USING btree (refreshed_at);
--> statement-breakpoint
CREATE INDEX profile_collaboration_summaries_stale_idx ON public.profile_collaboration_summaries USING btree (stale, updated_at);
--> statement-breakpoint
CREATE INDEX profile_contribution_drafts_profile_idx ON public.profile_contribution_drafts USING btree (profile_id);
--> statement-breakpoint
CREATE INDEX profile_contribution_media_assets_asset_idx ON public.profile_contribution_media_assets USING btree (asset_id);
--> statement-breakpoint
CREATE INDEX profile_contribution_skills_contribution_order_idx ON public.profile_contribution_skills USING btree (contribution_id, display_order);
--> statement-breakpoint
CREATE INDEX profile_contribution_skills_skill_idx ON public.profile_contribution_skills USING btree (skill_id);
--> statement-breakpoint
CREATE INDEX profile_contribution_skills_verified_by_idx ON public.profile_contribution_skills USING btree (verified_by);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_contribution_idx ON public.profile_contribution_stages USING btree (contribution_id, started_at DESC, created_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_contribution_ref_idx ON public.profile_contribution_stages USING btree (contribution_id);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_contribution_stages_current_unique ON public.profile_contribution_stages USING btree (contribution_id) WHERE ((deleted_at IS NULL) AND (ended_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX profile_contribution_stages_event_unique ON public.profile_contribution_stages USING btree (event_id) WHERE (event_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_profile_ref_idx ON public.profile_contribution_stages USING btree (profile_id);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_profile_workspace_idx ON public.profile_contribution_stages USING btree (profile_id, workspace_id, started_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_verified_by_idx ON public.profile_contribution_stages USING btree (verified_by);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_visible_idx ON public.profile_contribution_stages USING btree (profile_id, visibility, started_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX profile_contribution_stages_workspace_idx ON public.profile_contribution_stages USING btree (workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_contributions_profile_external_active_unique ON public.profile_contributions USING btree (profile_id, external_key) WHERE ((deleted_at IS NULL) AND (workspace_id IS NULL));
--> statement-breakpoint
CREATE INDEX profile_contributions_profile_idx ON public.profile_contributions USING btree (profile_id);
--> statement-breakpoint
CREATE INDEX profile_contributions_profile_visible_idx ON public.profile_contributions USING btree (profile_id, visibility, updated_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_contributions_profile_workspace_active_unique ON public.profile_contributions USING btree (profile_id, workspace_id) WHERE ((deleted_at IS NULL) AND (workspace_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX profile_contributions_verified_by_idx ON public.profile_contributions USING btree (verified_by);
--> statement-breakpoint
CREATE INDEX profile_contributions_verified_idx ON public.profile_contributions USING btree (profile_id, verified_at DESC) WHERE ((deleted_at IS NULL) AND (verified_at IS NOT NULL));
--> statement-breakpoint
CREATE INDEX profile_contributions_workspace_idx ON public.profile_contributions USING btree (workspace_id, updated_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX profile_contributions_workspace_ref_idx ON public.profile_contributions USING btree (workspace_id) WHERE (workspace_id IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER file_content_contribution AFTER INSERT OR UPDATE ON public.file_versions FOR EACH ROW EXECUTE FUNCTION public.record_file_content_contribution();
--> statement-breakpoint
ALTER TABLE ONLY public.profile_collaboration_summaries
    ADD CONSTRAINT profile_collaboration_summaries_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_drafts
    ADD CONSTRAINT profile_contribution_drafts_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES public.profile_contributions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_drafts
    ADD CONSTRAINT profile_contribution_drafts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_media_assets
    ADD CONSTRAINT profile_contribution_media_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_media_assets
    ADD CONSTRAINT profile_contribution_media_assets_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES public.profile_contributions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_skills
    ADD CONSTRAINT profile_contribution_skills_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES public.profile_contributions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_skills
    ADD CONSTRAINT profile_contribution_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_skills
    ADD CONSTRAINT profile_contribution_skills_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_stages
    ADD CONSTRAINT profile_contribution_stages_contribution_id_fkey FOREIGN KEY (contribution_id) REFERENCES public.profile_contributions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_stages
    ADD CONSTRAINT profile_contribution_stages_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_stages
    ADD CONSTRAINT profile_contribution_stages_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contribution_stages
    ADD CONSTRAINT profile_contribution_stages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contributions
    ADD CONSTRAINT profile_contributions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contributions
    ADD CONSTRAINT profile_contributions_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_contributions
    ADD CONSTRAINT profile_contributions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY contribution_drafts_owner ON public.profile_contribution_drafts TO authenticated USING ((profile_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((profile_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.profile_contributions c
  WHERE ((c.id = profile_contribution_drafts.contribution_id) AND (c.profile_id = ( SELECT auth.uid() AS uid)))))));
--> statement-breakpoint
CREATE POLICY contribution_media_owner ON public.profile_contribution_media_assets FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profile_contributions c
  WHERE ((c.id = profile_contribution_media_assets.contribution_id) AND (c.profile_id = ( SELECT auth.uid() AS uid))))));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_collaboration_summaries TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_contribution_drafts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_contribution_media_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_contribution_skills TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_contribution_stages TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_contributions TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.profile_collaboration_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_collaboration_summaries_select_visible ON public.profile_collaboration_summaries FOR SELECT TO authenticated, anon USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = profile_collaboration_summaries.profile_id) AND (p.deleted_at IS NULL) AND (p.visibility = 'public'::text))))));
--> statement-breakpoint
ALTER TABLE public.profile_contribution_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_contribution_skills_select_visible ON public.profile_contribution_skills FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.profile_contributions contribution
     LEFT JOIN public.workspaces project ON ((project.id = contribution.workspace_id)))
  WHERE ((contribution.id = profile_contribution_skills.contribution_id) AND (contribution.deleted_at IS NULL) AND ((contribution.profile_id = ( SELECT auth.uid() AS uid)) OR ((contribution.visibility = 'public'::text) AND (((contribution.workspace_id IS NULL) AND (contribution.external_key IS NOT NULL)) OR ((project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::public.status_workspace)))))))));
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_contribution_stages_read_authorized ON public.profile_contribution_stages FOR SELECT USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM (public.profile_contributions contribution
     LEFT JOIN public.workspaces project ON ((project.id = contribution.workspace_id)))
  WHERE ((contribution.id = profile_contribution_stages.contribution_id) AND (contribution.deleted_at IS NULL) AND (contribution.visibility = 'public'::text) AND (((contribution.workspace_id IS NULL) AND (contribution.external_key IS NOT NULL)) OR ((project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::public.status_workspace))))))));
--> statement-breakpoint
ALTER TABLE public.profile_contributions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_contributions_read_authorized ON public.profile_contributions FOR SELECT USING (((profile_id = ( SELECT auth.uid() AS uid)) OR ((visibility = 'public'::text) AND (deleted_at IS NULL) AND (((workspace_id IS NULL) AND (external_key IS NOT NULL)) OR (EXISTS ( SELECT 1
   FROM public.workspaces project
  WHERE ((project.id = profile_contributions.workspace_id) AND (project.deleted_at IS NULL) AND (project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (project.status <> 'draft'::public.status_workspace))))))));
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_file_content_contribution() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_file_content_contribution() TO service_role;
GRANT ALL ON FUNCTION public.record_file_content_contribution() TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_collaboration_summaries TO anon;
GRANT MAINTAIN ON TABLE public.profile_collaboration_summaries TO authenticated;
GRANT ALL ON TABLE public.profile_collaboration_summaries TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_collaboration_summaries TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.profile_contribution_drafts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_contribution_drafts TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.profile_contribution_media_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_contribution_media_assets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_contribution_skills TO anon;
GRANT MAINTAIN ON TABLE public.profile_contribution_skills TO authenticated;
GRANT ALL ON TABLE public.profile_contribution_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_contribution_skills TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_contribution_stages TO anon;
GRANT MAINTAIN ON TABLE public.profile_contribution_stages TO authenticated;
GRANT ALL ON TABLE public.profile_contribution_stages TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_contribution_stages TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_contributions TO anon;
GRANT MAINTAIN ON TABLE public.profile_contributions TO authenticated;
GRANT ALL ON TABLE public.profile_contributions TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_contributions TO nb_app;
