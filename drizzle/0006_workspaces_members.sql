-- Workspaces (organizations are workspaces too), members, open roles, applications, invitations, mentors, follows, tags, access helpers.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) RETURNS boolean
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
          SELECT 1
          FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin')
        )
      )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) RETURNS boolean
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
CREATE FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) RETURNS boolean
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
          SELECT 1
          FROM public.workspace_members pm
          WHERE pm.workspace_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'member')
        )
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
      )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_read_only(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces p
    LEFT JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE p.id = p_project_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
    )
  );
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_read_only_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_project uuid;
BEGIN
  IF TG_TABLE_NAME = 'project_update_comments' THEN
    SELECT u.workspace_id INTO v_project FROM public.workspace_updates u WHERE u.id = NEW.update_id;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    SELECT t.workspace_id INTO v_project FROM public.tasks t WHERE t.id = NEW.task_id;
  ELSE
    v_project := NEW.workspace_id;
  END IF;
  IF v_project IS NOT NULL AND app_private.nb_workspace_read_only(v_project) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_read_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) RETURNS boolean
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
CREATE FUNCTION app_private.nb_workspaces_two_levels() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspaces p WHERE p.id = NEW.parent_id AND p.kind = 'organization' FOR SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_parent_must_be_org';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.kind = 'organization' AND NEW.kind <> 'organization'
     AND EXISTS (SELECT 1 FROM public.workspaces c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'org_has_child_projects';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.sync_workspace_open_roles_count() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE public.workspaces p
  SET open_roles_count = (
    SELECT count(*) FROM public.workspace_open_roles r WHERE r.workspace_id = p.id AND r.filled < r.count
  )
  WHERE p.id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.workspace_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.workspace_id END
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.workspace_members_sync_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE public.workspaces SET owner_id = NEW.user_id, updated_at = now()
  WHERE id = NEW.workspace_id AND owner_id IS DISTINCT FROM NEW.user_id;
  RETURN NULL;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;
--> statement-breakpoint
CREATE TABLE public.application_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    actor_id uuid,
    kind text NOT NULL,
    from_status text,
    to_status text,
    reason_code text,
    reason_text text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT application_events_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'edited'::text, 'withdrawn'::text, 'reopened'::text, 'accepted'::text, 'rejected'::text, 'proposed'::text, 'proposal_accepted'::text, 'proposal_declined'::text]))),
    CONSTRAINT application_events_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);
--> statement-breakpoint
CREATE TABLE public.workspace_event_counters (
    workspace_id uuid NOT NULL,
    next_sequence bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_event_counters_next_sequence_check CHECK ((next_sequence >= 0))
);
--> statement-breakpoint
CREATE TABLE public.workspace_follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_mentors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    guide_user_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    review_at timestamp with time zone,
    public_attribution_consent boolean DEFAULT false NOT NULL,
    previous_membership_role text,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    ended_by uuid,
    end_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_mentors_previous_membership_role_check CHECK (((previous_membership_role IS NULL) OR (previous_membership_role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))),
    CONSTRAINT workspace_mentors_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text, 'revoked'::text])))
);
--> statement-breakpoint
CREATE TABLE public.workspace_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    inviter_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    kind text NOT NULL,
    role_id uuid,
    role_title text,
    guidance_label text,
    note text,
    project_title text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    review_at timestamp with time zone,
    idempotency_key text,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_invitations_kind_check CHECK ((kind = ANY (ARRAY['ordinary_role'::text, 'guidance_appointment'::text]))),
    CONSTRAINT workspace_invitations_snapshot_check CHECK ((((kind = 'ordinary_role'::text) AND (role_title IS NOT NULL) AND (guidance_label IS NULL)) OR ((kind = 'guidance_appointment'::text) AND (guidance_label IS NOT NULL) AND (role_id IS NULL)))),
    CONSTRAINT workspace_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text, 'expired'::text])))
);
--> statement-breakpoint
CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    file_upload_enabled boolean DEFAULT true NOT NULL,
    notification_preferences jsonb DEFAULT '{"mode": "inherit", "rules": {}, "version": 1}'::jsonb NOT NULL,
    title text,
    show_on_profile boolean DEFAULT true NOT NULL,
    last_seen_updates_at timestamp with time zone,
    unit_id uuid,
    CONSTRAINT workspace_members_title_length CHECK (((title IS NULL) OR (char_length(title) <= 60)))
);
--> statement-breakpoint
CREATE TABLE public.workspace_open_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    role text NOT NULL,
    title text,
    description text,
    count integer DEFAULT 1 NOT NULL,
    filled integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    skills jsonb DEFAULT '[]'::jsonb,
    commitment_type text,
    experience_required text,
    hours_per_week text,
    team_lead_user_id uuid,
    CONSTRAINT workspace_open_roles_count_non_negative_check CHECK ((count >= 0)),
    CONSTRAINT workspace_open_roles_filled_lte_count_check CHECK ((filled <= count)),
    CONSTRAINT workspace_open_roles_filled_non_negative_check CHECK ((filled >= 0))
);
--> statement-breakpoint
CREATE TABLE public.workspace_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    usage_kind text DEFAULT 'used'::text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    short_description text,
    cover_image text,
    category text,
    tags jsonb DEFAULT '[]'::jsonb,
    skills jsonb DEFAULT '[]'::jsonb,
    visibility text DEFAULT 'public'::text,
    status public.status_workspace DEFAULT 'draft'::public.status_workspace,
    looking_for_collaborators boolean DEFAULT false,
    max_collaborators text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text,
    view_count integer DEFAULT 0 NOT NULL,
    problem_statement text,
    solution_statement text,
    lifecycle_stages jsonb DEFAULT '[]'::jsonb,
    current_stage_index integer DEFAULT 0,
    key text,
    current_task_number integer DEFAULT 0,
    import_source jsonb,
    sync_status text DEFAULT 'ready'::text NOT NULL,
    followers_count integer DEFAULT 0 NOT NULL,
    saves_count integer DEFAULT 0 NOT NULL,
    github_repo_url text,
    github_default_branch text DEFAULT 'main'::text,
    github_last_sync_at timestamp with time zone,
    github_last_commit_sha text,
    deleted_at timestamp with time zone,
    cover_image_bucket text,
    cover_image_key text,
    public_tab_visibility jsonb DEFAULT '{"files": true, "tasks": false, "readme": true, "sprints": false, "updates": true, "dashboard": true}'::jsonb NOT NULL,
    notification_preferences jsonb DEFAULT '{"rules": {}, "preset": "balanced", "version": 1}'::jsonb NOT NULL,
    stage_completion_dates jsonb DEFAULT '{}'::jsonb,
    current_sequence_number bigint DEFAULT 0 NOT NULL,
    member_updates_enabled boolean DEFAULT true NOT NULL,
    open_roles_count integer DEFAULT 0 NOT NULL,
    external_links jsonb DEFAULT '{}'::jsonb NOT NULL,
    external_link_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    member_file_upload_default boolean DEFAULT true NOT NULL,
    cover_image_asset_id uuid,
    status_text text,
    status_expires_at timestamp with time zone,
    status_set_by uuid,
    status_set_at timestamp with time zone,
    status_emoji text,
    task_review_required boolean DEFAULT false NOT NULL,
    task_completion_policy_version integer DEFAULT 0 NOT NULL,
    kind text DEFAULT 'workspace'::text NOT NULL,
    parent_id uuid,
    org_type text,
    org_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    term_start date,
    term_end date,
    time_zone text,
    welcome_note text,
    join_code text,
    join_code_enabled boolean DEFAULT true NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    verification_domain text,
    suspended_at timestamp with time zone,
    suspend_reason text,
    deletion_scheduled_at timestamp with time zone,
    discover_hidden_at timestamp with time zone,
    verification_requested_at timestamp with time zone,
    restricted_at timestamp with time zone,
    CONSTRAINT workspaces_kind_check CHECK ((kind = ANY (ARRAY['workspace'::text, 'organization'::text]))),
    CONSTRAINT workspaces_org_has_no_parent CHECK (((kind = 'workspace'::text) OR (parent_id IS NULL))),
    CONSTRAINT workspaces_org_type_check CHECK (((org_type IS NULL) OR (org_type = ANY (ARRAY['education'::text, 'company'::text, 'community'::text, 'research'::text, 'club'::text, 'other'::text])))),
    CONSTRAINT workspaces_status_emoji_check CHECK (((status_emoji IS NULL) OR ((char_length(status_emoji) >= 1) AND (char_length(status_emoji) <= 16)))),
    CONSTRAINT workspaces_status_text_check CHECK (((status_text IS NULL) OR (char_length(status_text) <= 80))),
    CONSTRAINT workspaces_term_check CHECK (((term_end IS NULL) OR (term_start IS NULL) OR (term_end >= term_start)))
);
--> statement-breakpoint
CREATE TABLE public.role_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    role_id uuid,
    applicant_id uuid NOT NULL,
    creator_id uuid,
    status public.status_role_application DEFAULT 'pending'::public.status_role_application NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    message text,
    accepted_role_title text,
    decision_at timestamp with time zone,
    decision_by uuid,
    decision_reason_code text,
    decision_reason_text text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT role_applications_accepted_decided_check CHECK (((status <> 'accepted'::public.status_role_application) OR (decision_at IS NOT NULL))),
    CONSTRAINT role_applications_details_object_check CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT role_applications_message_length_check CHECK (((message IS NULL) OR (char_length(message) <= 2000))),
    CONSTRAINT role_applications_reason_code_check CHECK (((decision_reason_code IS NULL) OR (decision_reason_code = ANY (ARRAY['skills_mismatch'::text, 'role_filled'::text, 'project_closed'::text, 'role_removed'::text, 'availability'::text, 'experience'::text, 'other'::text, 'withdrawn_by_applicant'::text, 'reopened_by_reviewer'::text]))))
);
--> statement-breakpoint
CREATE TABLE public.role_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    requirement text DEFAULT 'required'::text NOT NULL,
    minimum_proficiency text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_skills_requirement_check CHECK ((requirement = ANY (ARRAY['required'::text, 'preferred'::text])))
);
--> statement-breakpoint
CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.application_events
    ADD CONSTRAINT application_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.role_skills
    ADD CONSTRAINT role_skills_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.role_skills
    ADD CONSTRAINT role_skills_unique UNIQUE (role_id, skill_id);
--> statement-breakpoint
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_unique UNIQUE (name);
--> statement-breakpoint
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_slug_unique UNIQUE (slug);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_event_counters
    ADD CONSTRAINT workspace_event_counters_pkey PRIMARY KEY (workspace_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_follows
    ADD CONSTRAINT workspace_follows_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_mentors
    ADD CONSTRAINT workspace_mentors_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_open_roles
    ADD CONSTRAINT workspace_open_roles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_key_unique UNIQUE (key);
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_unique UNIQUE (slug);
--> statement-breakpoint
CREATE INDEX application_events_actor_created_idx ON public.application_events USING btree (actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX application_events_application_created_idx ON public.application_events USING btree (application_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX application_events_kind_created_idx ON public.application_events USING btree (kind, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX role_applicant_uniq_idx ON public.role_applications USING btree (role_id, applicant_id);
--> statement-breakpoint
CREATE INDEX role_applications_accepted_member_idx ON public.role_applications USING btree (workspace_id, applicant_id, status, updated_at);
--> statement-breakpoint
CREATE INDEX role_applications_applicant_idx ON public.role_applications USING btree (applicant_id, status);
--> statement-breakpoint
CREATE INDEX role_applications_cooldown_idx ON public.role_applications USING btree (workspace_id, applicant_id, updated_at);
--> statement-breakpoint
CREATE INDEX role_applications_creator_pending_idx ON public.role_applications USING btree (creator_id, status);
--> statement-breakpoint
CREATE INDEX role_applications_decision_by_idx ON public.role_applications USING btree (decision_by);
--> statement-breakpoint
CREATE INDEX role_applications_pending_workspace_idx ON public.role_applications USING btree (workspace_id) WHERE (status = 'pending'::public.status_role_application);
--> statement-breakpoint
CREATE INDEX role_applications_role_status_idx ON public.role_applications USING btree (role_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX role_applications_unique_idx ON public.role_applications USING btree (workspace_id, applicant_id);
--> statement-breakpoint
CREATE INDEX role_applications_workspace_role_pending_idx ON public.role_applications USING btree (workspace_id, role_id) WHERE (status = 'pending'::public.status_role_application);
--> statement-breakpoint
CREATE INDEX role_applications_workspace_updated_idx ON public.role_applications USING btree (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX role_skills_role_order_idx ON public.role_skills USING btree (role_id, display_order);
--> statement-breakpoint
CREATE INDEX role_skills_skill_idx ON public.role_skills USING btree (skill_id);
--> statement-breakpoint
CREATE INDEX tags_name_search_idx ON public.tags USING gin (name extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_follows_unique_idx ON public.workspace_follows USING btree (workspace_id, user_id);
--> statement-breakpoint
CREATE INDEX workspace_follows_user_id_idx ON public.workspace_follows USING btree (user_id);
--> statement-breakpoint
CREATE INDEX workspace_follows_workspace_id_idx ON public.workspace_follows USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_invitations_candidate_inbox_idx ON public.workspace_invitations USING btree (candidate_id, status, created_at);
--> statement-breakpoint
CREATE INDEX workspace_invitations_expires_idx ON public.workspace_invitations USING btree (expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invitations_idempotency_unique ON public.workspace_invitations USING btree (inviter_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_invitations_inviter_idx ON public.workspace_invitations USING btree (inviter_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invitations_pending_guidance_unique ON public.workspace_invitations USING btree (workspace_id) WHERE ((kind = 'guidance_appointment'::text) AND (status = 'pending'::text));
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invitations_pending_ordinary_unique ON public.workspace_invitations USING btree (workspace_id, candidate_id) WHERE ((kind = 'ordinary_role'::text) AND (status = 'pending'::text));
--> statement-breakpoint
CREATE INDEX workspace_invitations_resolved_by_idx ON public.workspace_invitations USING btree (resolved_by);
--> statement-breakpoint
CREATE INDEX workspace_invitations_role_idx ON public.workspace_invitations USING btree (role_id);
--> statement-breakpoint
CREATE INDEX workspace_invitations_workspace_candidate_idx ON public.workspace_invitations USING btree (workspace_id, candidate_id, status, created_at);
--> statement-breakpoint
CREATE INDEX workspace_members_file_upload_idx ON public.workspace_members USING btree (workspace_id, file_upload_enabled);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_members_one_owner ON public.workspace_members USING btree (workspace_id) WHERE (role = 'owner'::text);
--> statement-breakpoint
CREATE INDEX workspace_members_unit_idx ON public.workspace_members USING btree (unit_id) WHERE (unit_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);
--> statement-breakpoint
CREATE INDEX workspace_members_user_role_idx ON public.workspace_members USING btree (user_id, role);
--> statement-breakpoint
CREATE INDEX workspace_members_workspace_idx ON public.workspace_members USING btree (workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON public.workspace_members USING btree (workspace_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_mentors_active_workspace_unique ON public.workspace_mentors USING btree (workspace_id) WHERE (status = 'active'::text);
--> statement-breakpoint
CREATE INDEX workspace_mentors_ended_by_idx ON public.workspace_mentors USING btree (ended_by);
--> statement-breakpoint
CREATE INDEX workspace_mentors_guide_active_idx ON public.workspace_mentors USING btree (guide_user_id, accepted_at) WHERE (status = 'active'::text);
--> statement-breakpoint
CREATE INDEX workspace_mentors_guide_idx ON public.workspace_mentors USING btree (guide_user_id);
--> statement-breakpoint
CREATE INDEX workspace_mentors_invitation_idx ON public.workspace_mentors USING btree (invitation_id);
--> statement-breakpoint
CREATE INDEX workspace_mentors_workspace_guide_idx ON public.workspace_mentors USING btree (workspace_id, guide_user_id, status);
--> statement-breakpoint
CREATE INDEX workspace_open_roles_lead_user_idx ON public.workspace_open_roles USING btree (team_lead_user_id) WHERE (team_lead_user_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_open_roles_workspace_idx ON public.workspace_open_roles USING btree (workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_open_roles_workspace_updated_idx ON public.workspace_open_roles USING btree (workspace_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_skills_skill_idx ON public.workspace_skills USING btree (skill_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_skills_unique_idx ON public.workspace_skills USING btree (workspace_id, skill_id);
--> statement-breakpoint
CREATE INDEX workspace_skills_workspace_order_idx ON public.workspace_skills USING btree (workspace_id, display_order);
--> statement-breakpoint
CREATE INDEX workspace_tags_tag_idx ON public.workspace_tags USING btree (tag_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_tags_unique_idx ON public.workspace_tags USING btree (workspace_id, tag_id);
--> statement-breakpoint
CREATE INDEX workspaces_category_status_idx ON public.workspaces USING btree (category, status);
--> statement-breakpoint
CREATE INDEX workspaces_cover_image_asset_idx ON public.workspaces USING btree (cover_image_asset_id);
--> statement-breakpoint
CREATE INDEX workspaces_created_at_idx ON public.workspaces USING btree (created_at);
--> statement-breakpoint
CREATE INDEX workspaces_created_at_status_idx ON public.workspaces USING btree (created_at, status);
--> statement-breakpoint
CREATE INDEX workspaces_deletion_scheduled_idx ON public.workspaces USING btree (deletion_scheduled_at) WHERE (deletion_scheduled_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspaces_description_search_idx ON public.workspaces USING gin (description extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX workspaces_discover_most_followed_idx ON public.workspaces USING btree (followers_count DESC, created_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (status <> 'draft'::public.status_workspace));
--> statement-breakpoint
CREATE INDEX workspaces_discover_most_viewed_idx ON public.workspaces USING btree (view_count DESC, created_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (status <> 'draft'::public.status_workspace));
--> statement-breakpoint
CREATE INDEX workspaces_discover_newest_idx ON public.workspaces USING btree (created_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) AND (status <> 'draft'::public.status_workspace));
--> statement-breakpoint
CREATE INDEX workspaces_feed_most_viewed_idx ON public.workspaces USING btree (visibility, status, view_count);
--> statement-breakpoint
CREATE UNIQUE INDEX workspaces_join_code_unique ON public.workspaces USING btree (join_code) WHERE (join_code IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspaces_my_workspaces_idx ON public.workspaces USING btree (owner_id, created_at);
--> statement-breakpoint
CREATE INDEX workspaces_owner_deleted_view_count_idx ON public.workspaces USING btree (owner_id, deleted_at, view_count);
--> statement-breakpoint
CREATE INDEX workspaces_owner_idx ON public.workspaces USING btree (owner_id);
--> statement-breakpoint
CREATE INDEX workspaces_parent_idx ON public.workspaces USING btree (parent_id) WHERE (parent_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspaces_public_feed_most_followed_active_idx ON public.workspaces USING btree (visibility, status, followers_count DESC, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspaces_status_idx ON public.workspaces USING btree (status);
--> statement-breakpoint
CREATE INDEX workspaces_status_set_by_idx ON public.workspaces USING btree (status_set_by);
--> statement-breakpoint
CREATE INDEX workspaces_status_visibility_idx ON public.workspaces USING btree (status, visibility);
--> statement-breakpoint
CREATE INDEX workspaces_title_search_idx ON public.workspaces USING gin (title extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX workspaces_verification_requested_idx ON public.workspaces USING btree (verification_requested_at) WHERE (verification_requested_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspaces_verified_by_idx ON public.workspaces USING btree (verified_by) WHERE (verified_by IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER role_applications_join_block BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_join_block BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_members_join_block BEFORE INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_members_sync_owner AFTER INSERT OR UPDATE OF role ON public.workspace_members FOR EACH ROW WHEN ((new.role = 'owner'::text)) EXECUTE FUNCTION public.workspace_members_sync_owner();
--> statement-breakpoint
CREATE TRIGGER workspace_open_roles_sync_count AFTER INSERT OR DELETE OR UPDATE ON public.workspace_open_roles FOR EACH ROW EXECUTE FUNCTION public.sync_workspace_open_roles_count();
--> statement-breakpoint
CREATE TRIGGER workspaces_two_levels BEFORE INSERT OR UPDATE OF kind, parent_id ON public.workspaces FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspaces_two_levels();
--> statement-breakpoint
ALTER TABLE ONLY public.application_events
    ADD CONSTRAINT application_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.application_events
    ADD CONSTRAINT application_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.role_applications(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_applicant_id_profiles_id_fk FOREIGN KEY (applicant_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_creator_id_profiles_id_fk FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_decision_by_profiles_id_fk FOREIGN KEY (decision_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_role_id_workspace_open_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.workspace_open_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.role_applications
    ADD CONSTRAINT role_applications_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.role_skills
    ADD CONSTRAINT role_skills_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.workspace_open_roles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.role_skills
    ADD CONSTRAINT role_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_event_counters
    ADD CONSTRAINT workspace_event_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_follows
    ADD CONSTRAINT workspace_follows_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_follows
    ADD CONSTRAINT workspace_follows_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.workspace_open_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.workspace_open_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_mentors
    ADD CONSTRAINT workspace_mentors_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_mentors
    ADD CONSTRAINT workspace_mentors_guide_user_id_fkey FOREIGN KEY (guide_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_mentors
    ADD CONSTRAINT workspace_mentors_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.workspace_invitations(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_mentors
    ADD CONSTRAINT workspace_mentors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_open_roles
    ADD CONSTRAINT workspace_open_roles_lead_user_id_fkey FOREIGN KEY (team_lead_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_open_roles
    ADD CONSTRAINT workspace_open_roles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_skill_id_skills_id_fk FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_cover_image_asset_id_fkey FOREIGN KEY (cover_image_asset_id) REFERENCES public.storage_assets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_profiles_id_fk FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_status_set_by_fkey FOREIGN KEY (status_set_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY application_events_select_actor_or_workspace_admin ON public.application_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.role_applications application
  WHERE ((application.id = application_events.application_id) AND ((application.applicant_id = ( SELECT auth.uid() AS uid)) OR app_private.nb_workspace_can_admin(application.workspace_id))))));
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.application_events TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.role_applications TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.role_skills TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.tags TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_event_counters TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_follows TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_invitations TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_members TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_mentors TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_open_roles TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_skills TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_tags TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspaces TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.role_applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_applications_select_actor_or_workspace_admin ON public.role_applications FOR SELECT TO authenticated USING (((applicant_id = ( SELECT auth.uid() AS uid)) OR app_private.nb_workspace_can_admin(workspace_id)));
--> statement-breakpoint
ALTER TABLE public.role_skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_skills_select_visible ON public.role_skills FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.workspace_open_roles role
     JOIN public.workspaces project ON ((project.id = role.workspace_id)))
  WHERE ((role.id = role_skills.role_id) AND (project.deleted_at IS NULL) AND ((project.visibility = ANY (ARRAY['public'::text, 'unlisted'::text])) OR (project.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members member
          WHERE ((member.workspace_id = project.id) AND (member.user_id = ( SELECT auth.uid() AS uid))))))))));
--> statement-breakpoint
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tags_select_visible ON public.tags FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE public.workspace_event_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_follows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_follows_delete_own ON public.workspace_follows FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY workspace_follows_insert_own ON public.workspace_follows FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY workspace_follows_select_visible ON public.workspace_follows FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_follows_update_own ON public.workspace_follows FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_invitations_select_workspace_member ON public.workspace_invitations FOR SELECT TO authenticated USING (((candidate_id = ( SELECT auth.uid() AS uid)) OR (inviter_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = workspace_invitations.workspace_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.workspace_members
  WHERE ((workspace_members.workspace_id = workspace_invitations.workspace_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid)))))));
--> statement-breakpoint
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_members_select_visible ON public.workspace_members FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_mentors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_mentors_select_author_or_workspace_admin ON public.workspace_mentors FOR SELECT TO authenticated USING (((guide_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = workspace_mentors.workspace_id) AND (workspaces.owner_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.workspace_members
  WHERE ((workspace_members.workspace_id = workspace_mentors.workspace_id) AND (workspace_members.user_id = ( SELECT auth.uid() AS uid))))) OR (public_attribution_consent AND (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = workspace_mentors.workspace_id) AND (workspaces.visibility = 'public'::text) AND (workspaces.deleted_at IS NULL)))))));
--> statement-breakpoint
ALTER TABLE public.workspace_open_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_open_roles_delete_workspace_admin ON public.workspace_open_roles FOR DELETE TO authenticated USING (app_private.nb_workspace_can_admin(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_open_roles_insert_workspace_admin ON public.workspace_open_roles FOR INSERT TO authenticated WITH CHECK (app_private.nb_workspace_can_admin(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_open_roles_select_visible ON public.workspace_open_roles FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_open_roles_update_workspace_admin ON public.workspace_open_roles FOR UPDATE TO authenticated USING (app_private.nb_workspace_can_admin(workspace_id)) WITH CHECK (app_private.nb_workspace_can_admin(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_skills ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_skills_select_visible ON public.workspace_skills FOR SELECT USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspace_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_tags_select_visible ON public.workspace_tags FOR SELECT USING (app_private.nb_workspace_can_read(workspace_id));
--> statement-breakpoint
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_insert_own ON public.workspaces FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));
--> statement-breakpoint
CREATE POLICY workspaces_read ON public.workspaces FOR SELECT TO authenticated, anon USING (app_private.nb_workspace_can_read(id));
--> statement-breakpoint
CREATE POLICY workspaces_update_own ON public.workspaces FOR UPDATE USING ((( SELECT auth.uid() AS uid) = owner_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_admin(p_project_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_read(p_project_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_read_only(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_read_only(p_project_id uuid) TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_workspace_read_only_guard() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) TO anon;
GRANT ALL ON FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_workspace_tab_visible(p_project_id uuid, p_tab text) TO nb_app;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_workspaces_two_levels() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.sync_workspace_open_roles_count() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_workspace_open_roles_count() TO service_role;
GRANT ALL ON FUNCTION public.sync_workspace_open_roles_count() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.workspace_members_sync_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_members_sync_owner() TO service_role;
GRANT ALL ON FUNCTION public.workspace_members_sync_owner() TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.application_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.application_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_event_counters TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_event_counters TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_follows TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_follows TO authenticated;
GRANT ALL ON TABLE public.workspace_follows TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_follows TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_mentors TO anon;
GRANT MAINTAIN ON TABLE public.workspace_mentors TO authenticated;
GRANT ALL ON TABLE public.workspace_mentors TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_mentors TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_invitations TO anon;
GRANT MAINTAIN ON TABLE public.workspace_invitations TO authenticated;
GRANT ALL ON TABLE public.workspace_invitations TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_invitations TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_members TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_members TO authenticated;
GRANT ALL ON TABLE public.workspace_members TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_members TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_open_roles TO anon;
GRANT MAINTAIN ON TABLE public.workspace_open_roles TO authenticated;
GRANT ALL ON TABLE public.workspace_open_roles TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_open_roles TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_skills TO anon;
GRANT MAINTAIN ON TABLE public.workspace_skills TO authenticated;
GRANT ALL ON TABLE public.workspace_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_skills TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_tags TO anon;
GRANT MAINTAIN ON TABLE public.workspace_tags TO authenticated;
GRANT ALL ON TABLE public.workspace_tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_tags TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspaces TO anon;
GRANT MAINTAIN ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspaces TO nb_app;
--> statement-breakpoint
GRANT SELECT(id) ON TABLE public.workspaces TO anon;
GRANT SELECT(id) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(owner_id) ON TABLE public.workspaces TO anon;
GRANT SELECT(owner_id) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(title) ON TABLE public.workspaces TO anon;
GRANT SELECT(title) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(description) ON TABLE public.workspaces TO anon;
GRANT SELECT(description) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(short_description) ON TABLE public.workspaces TO anon;
GRANT SELECT(short_description) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image) ON TABLE public.workspaces TO anon;
GRANT SELECT(cover_image) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(category) ON TABLE public.workspaces TO anon;
GRANT SELECT(category) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(tags) ON TABLE public.workspaces TO anon;
GRANT SELECT(tags) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(skills) ON TABLE public.workspaces TO anon;
GRANT SELECT(skills) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(visibility) ON TABLE public.workspaces TO anon;
GRANT SELECT(visibility) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status) ON TABLE public.workspaces TO anon;
GRANT SELECT(status) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(looking_for_collaborators) ON TABLE public.workspaces TO anon;
GRANT SELECT(looking_for_collaborators) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(max_collaborators) ON TABLE public.workspaces TO anon;
GRANT SELECT(max_collaborators) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(created_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(created_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(updated_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(updated_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(slug) ON TABLE public.workspaces TO anon;
GRANT SELECT(slug) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(view_count) ON TABLE public.workspaces TO anon;
GRANT SELECT(view_count) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(problem_statement) ON TABLE public.workspaces TO anon;
GRANT SELECT(problem_statement) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(solution_statement) ON TABLE public.workspaces TO anon;
GRANT SELECT(solution_statement) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(lifecycle_stages) ON TABLE public.workspaces TO anon;
GRANT SELECT(lifecycle_stages) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_stage_index) ON TABLE public.workspaces TO anon;
GRANT SELECT(current_stage_index) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(key) ON TABLE public.workspaces TO anon;
GRANT SELECT(key) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_task_number) ON TABLE public.workspaces TO anon;
GRANT SELECT(current_task_number) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(sync_status) ON TABLE public.workspaces TO anon;
GRANT SELECT(sync_status) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(followers_count) ON TABLE public.workspaces TO anon;
GRANT SELECT(followers_count) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(saves_count) ON TABLE public.workspaces TO anon;
GRANT SELECT(saves_count) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_repo_url) ON TABLE public.workspaces TO anon;
GRANT SELECT(github_repo_url) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_default_branch) ON TABLE public.workspaces TO anon;
GRANT SELECT(github_default_branch) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_last_sync_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(github_last_sync_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(github_last_commit_sha) ON TABLE public.workspaces TO anon;
GRANT SELECT(github_last_commit_sha) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(deleted_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(deleted_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_bucket) ON TABLE public.workspaces TO anon;
GRANT SELECT(cover_image_bucket) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_key) ON TABLE public.workspaces TO anon;
GRANT SELECT(cover_image_key) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(public_tab_visibility) ON TABLE public.workspaces TO anon;
GRANT SELECT(public_tab_visibility) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(notification_preferences) ON TABLE public.workspaces TO anon;
GRANT SELECT(notification_preferences) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(stage_completion_dates) ON TABLE public.workspaces TO anon;
GRANT SELECT(stage_completion_dates) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(current_sequence_number) ON TABLE public.workspaces TO anon;
GRANT SELECT(current_sequence_number) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(member_updates_enabled) ON TABLE public.workspaces TO anon;
GRANT SELECT(member_updates_enabled) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(open_roles_count) ON TABLE public.workspaces TO anon;
GRANT SELECT(open_roles_count) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(external_links) ON TABLE public.workspaces TO anon;
GRANT SELECT(external_links) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(external_link_metadata) ON TABLE public.workspaces TO anon;
GRANT SELECT(external_link_metadata) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(member_file_upload_default) ON TABLE public.workspaces TO anon;
GRANT SELECT(member_file_upload_default) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(cover_image_asset_id) ON TABLE public.workspaces TO anon;
GRANT SELECT(cover_image_asset_id) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_text) ON TABLE public.workspaces TO anon;
GRANT SELECT(status_text) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_expires_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(status_expires_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_set_by) ON TABLE public.workspaces TO anon;
GRANT SELECT(status_set_by) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_set_at) ON TABLE public.workspaces TO anon;
GRANT SELECT(status_set_at) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT(status_emoji) ON TABLE public.workspaces TO anon;
GRANT SELECT(status_emoji) ON TABLE public.workspaces TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE public.role_applications TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_applications TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.role_skills TO anon;
GRANT MAINTAIN ON TABLE public.role_skills TO authenticated;
GRANT ALL ON TABLE public.role_skills TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_skills TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.tags TO anon;
GRANT MAINTAIN ON TABLE public.tags TO authenticated;
GRANT ALL ON TABLE public.tags TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tags TO nb_app;
--> statement-breakpoint
CREATE POLICY task_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'task-files'::text) AND (split_part(name, '/'::text, 1) <> ''::text) AND ((EXISTS ( SELECT 1
   FROM public.workspaces project
  WHERE (((project.id)::text = split_part(objects.name, '/'::text, 1)) AND (project.deleted_at IS NULL) AND (project.owner_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM public.workspace_members member
  WHERE (((member.workspace_id)::text = split_part(objects.name, '/'::text, 1)) AND (member.user_id = ( SELECT auth.uid() AS uid)) AND (member.role <> 'viewer'::text)))))));
--> statement-breakpoint
CREATE POLICY task_files_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'task-files'::text) AND (( SELECT auth.uid() AS uid) IN ( SELECT pm.user_id
   FROM public.workspace_members pm
  WHERE (pm.workspace_id = ((storage.foldername(objects.name))[1])::uuid)
UNION
 SELECT p.owner_id
   FROM public.workspaces p
  WHERE (p.id = ((storage.foldername(objects.name))[1])::uuid)))));
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
