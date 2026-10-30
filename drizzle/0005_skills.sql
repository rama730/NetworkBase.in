-- Skill catalog tables, aliases, icons, proposals, profile skills. The rows are in the skill catalog file.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE TABLE public.profile_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    proficiency text,
    years_experience integer,
    is_primary boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.skill_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id uuid NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    source text DEFAULT 'catalog'::text NOT NULL,
    is_preferred boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.skill_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    icon_key text DEFAULT 'badge'::text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_categories_status_check CHECK ((status = ANY (ARRAY['active'::text, 'hidden'::text])))
);
--> statement-breakpoint
CREATE TABLE public.skill_icon_assets (
    icon_key text NOT NULL,
    source text NOT NULL,
    source_slug text,
    source_version text NOT NULL,
    asset_path text NOT NULL,
    checksum text NOT NULL,
    brand_color text,
    license_type text,
    license_url text,
    source_url text,
    guidelines_url text,
    approval_status text DEFAULT 'catalog_approved'::text NOT NULL,
    last_reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_icon_assets_approval_check CHECK ((approval_status = ANY (ARRAY['catalog_approved'::text, 'blocked'::text, 'needs_review'::text]))),
    CONSTRAINT skill_icon_assets_source_check CHECK ((source = ANY (ARRAY['simple-icons'::text, 'devicon'::text, 'skill-icons'::text, 'logos'::text, 'developer-icons'::text, 'lucide'::text, 'custom'::text])))
);
--> statement-breakpoint
CREATE TABLE public.skill_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submitted_by uuid NOT NULL,
    label text NOT NULL,
    normalized_label text NOT NULL,
    context text,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_skill_id uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'merged'::text, 'rejected'::text])))
);
--> statement-breakpoint
CREATE TABLE public.skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    canonical_key text NOT NULL,
    category_id uuid,
    kind text DEFAULT 'competency'::text NOT NULL,
    description text,
    icon_source text DEFAULT 'monogram'::text NOT NULL,
    icon_key text DEFAULT 'badge'::text NOT NULL,
    brand_color text,
    market_tier text DEFAULT 'extended'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    selectable boolean DEFAULT true NOT NULL,
    replacement_skill_id uuid,
    source_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    catalog_version text DEFAULT 'legacy'::text NOT NULL,
    last_reviewed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skills_icon_source_check CHECK ((icon_source = ANY (ARRAY['simple-icons'::text, 'devicon'::text, 'skill-icons'::text, 'logos'::text, 'developer-icons'::text, 'lucide'::text, 'custom'::text, 'monogram'::text]))),
    CONSTRAINT skills_kind_check CHECK ((kind = ANY (ARRAY['language'::text, 'framework'::text, 'library'::text, 'database'::text, 'platform'::text, 'tool'::text, 'protocol'::text, 'methodology'::text, 'competency'::text, 'domain'::text]))),
    CONSTRAINT skills_market_tier_check CHECK ((market_tier = ANY (ARRAY['core'::text, 'extended'::text, 'reference'::text]))),
    CONSTRAINT skills_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deprecated'::text, 'merged'::text, 'hidden'::text, 'pending'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_skills
    ADD CONSTRAINT profile_skills_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_normalized_locale_unique UNIQUE (normalized_alias, locale);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_categories
    ADD CONSTRAINT skill_categories_key_unique UNIQUE (key);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_categories
    ADD CONSTRAINT skill_categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_icon_assets
    ADD CONSTRAINT skill_icon_assets_pkey PRIMARY KEY (icon_key);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_proposals
    ADD CONSTRAINT skill_proposals_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.skill_proposals
    ADD CONSTRAINT skill_proposals_user_label_unique UNIQUE (submitted_by, normalized_label);
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_canonical_key_unique UNIQUE (canonical_key);
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_name_unique UNIQUE (name);
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_slug_unique UNIQUE (slug);
--> statement-breakpoint
CREATE INDEX profile_skills_profile_order_idx ON public.profile_skills USING btree (profile_id, display_order);
--> statement-breakpoint
CREATE INDEX profile_skills_skill_idx ON public.profile_skills USING btree (skill_id);
--> statement-breakpoint
CREATE UNIQUE INDEX profile_skills_unique_idx ON public.profile_skills USING btree (profile_id, skill_id);
--> statement-breakpoint
CREATE INDEX skill_aliases_search_idx ON public.skill_aliases USING gin (normalized_alias extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX skill_aliases_skill_idx ON public.skill_aliases USING btree (skill_id);
--> statement-breakpoint
CREATE INDEX skill_categories_order_idx ON public.skill_categories USING btree (status, display_order);
--> statement-breakpoint
CREATE INDEX skill_proposals_resolved_skill_id_idx ON public.skill_proposals USING btree (resolved_skill_id);
--> statement-breakpoint
CREATE INDEX skill_proposals_reviewed_by_idx ON public.skill_proposals USING btree (reviewed_by);
--> statement-breakpoint
CREATE INDEX skill_proposals_status_created_idx ON public.skill_proposals USING btree (status, created_at);
--> statement-breakpoint
CREATE INDEX skills_category_kind_status_idx ON public.skills USING btree (category_id, kind, status);
--> statement-breakpoint
CREATE INDEX skills_name_search_idx ON public.skills USING gin (name extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX skills_replacement_skill_id_idx ON public.skills USING btree (replacement_skill_id);
--> statement-breakpoint
CREATE INDEX skills_search_document_idx ON public.skills USING gin (to_tsvector('simple'::regconfig, ((COALESCE(name, ''::text) || ' '::text) || COALESCE(description, ''::text))));
--> statement-breakpoint
CREATE INDEX skills_tier_status_name_idx ON public.skills USING btree (market_tier, status, name);
--> statement-breakpoint
ALTER TABLE ONLY public.profile_skills
    ADD CONSTRAINT profile_skills_profile_id_profiles_id_fk FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.profile_skills
    ADD CONSTRAINT profile_skills_skill_id_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.skill_proposals
    ADD CONSTRAINT skill_proposals_resolved_skill_id_fkey FOREIGN KEY (resolved_skill_id) REFERENCES public.skills(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.skill_proposals
    ADD CONSTRAINT skill_proposals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.skill_proposals
    ADD CONSTRAINT skill_proposals_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_category_id_skill_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.skill_categories(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_replacement_skill_id_skills_id_fk FOREIGN KEY (replacement_skill_id) REFERENCES public.skills(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.profile_skills TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.skill_aliases TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.skill_categories TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.skill_icon_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.skill_proposals TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.skills TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.profile_skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profile_skills_all_own ON public.profile_skills USING ((profile_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((profile_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.skill_aliases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_aliases_select_visible ON public.skill_aliases FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_categories_select_visible ON public.skill_categories FOR SELECT USING ((status = 'active'::text));
--> statement-breakpoint
ALTER TABLE public.skill_icon_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_icon_assets_select_visible ON public.skill_icon_assets FOR SELECT USING ((approval_status = 'catalog_approved'::text));
--> statement-breakpoint
ALTER TABLE public.skill_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skill_proposals_insert_own ON public.skill_proposals FOR INSERT WITH CHECK ((submitted_by = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY skill_proposals_select_own ON public.skill_proposals FOR SELECT USING ((submitted_by = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY skills_select_visible ON public.skills FOR SELECT USING (true);
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.profile_skills TO anon;
GRANT MAINTAIN ON TABLE public.profile_skills TO authenticated;
GRANT ALL ON TABLE public.profile_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profile_skills TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.skill_aliases TO anon;
GRANT MAINTAIN ON TABLE public.skill_aliases TO authenticated;
GRANT ALL ON TABLE public.skill_aliases TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skill_aliases TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.skill_categories TO anon;
GRANT MAINTAIN ON TABLE public.skill_categories TO authenticated;
GRANT ALL ON TABLE public.skill_categories TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skill_categories TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.skill_icon_assets TO anon;
GRANT MAINTAIN ON TABLE public.skill_icon_assets TO authenticated;
GRANT ALL ON TABLE public.skill_icon_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skill_icon_assets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.skill_proposals TO anon;
GRANT MAINTAIN ON TABLE public.skill_proposals TO authenticated;
GRANT ALL ON TABLE public.skill_proposals TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skill_proposals TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.skills TO anon;
GRANT MAINTAIN ON TABLE public.skills TO authenticated;
GRANT ALL ON TABLE public.skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.skills TO nb_app;
