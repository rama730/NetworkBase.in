-- 0241_organizations_core.sql
-- Organizations (docs/organization-concept-report.md §4, §29.4, §30.2): an org is a project with
-- kind = 'organization'; a child project points to it with parent_id. Two levels only.
-- Read rules: 'org' visibility = readable by people in the parent org; org owners and admins
-- (inherited admins) read and write every child project. Mirrors src/lib/data/project-access.ts.

ALTER TABLE public.projects
  ADD COLUMN kind text NOT NULL DEFAULT 'project',
  ADD COLUMN parent_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN org_type text,
  ADD COLUMN org_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN term_start date,
  ADD COLUMN term_end date,
  ADD COLUMN time_zone text,
  ADD COLUMN welcome_note text,
  ADD COLUMN join_code text,
  ADD COLUMN join_code_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN verification_domain text,
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspend_reason text,
  ADD COLUMN deletion_scheduled_at timestamptz,
  ADD CONSTRAINT projects_kind_check CHECK (kind IN ('project', 'organization')),
  ADD CONSTRAINT projects_org_has_no_parent CHECK (kind = 'project' OR parent_id IS NULL),
  ADD CONSTRAINT projects_org_type_check CHECK (org_type IS NULL OR org_type IN ('education', 'company', 'community', 'research', 'club')),
  ADD CONSTRAINT projects_term_check CHECK (term_end IS NULL OR term_start IS NULL OR term_end >= term_start);

--> statement-breakpoint

CREATE INDEX projects_parent_idx ON public.projects(parent_id) WHERE parent_id IS NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX projects_join_code_unique ON public.projects(join_code) WHERE join_code IS NOT NULL;

--> statement-breakpoint

-- A parent must be an org (so a child can never have children), and an org keeps its kind while it has children.
CREATE FUNCTION app_private.nb_projects_two_levels()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.parent_id AND p.kind = 'organization' FOR SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_parent_must_be_org';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.kind = 'organization' AND NEW.kind <> 'organization'
     AND EXISTS (SELECT 1 FROM public.projects c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'org_has_child_projects';
  END IF;
  RETURN NEW;
END
$$;

--> statement-breakpoint

CREATE TRIGGER projects_two_levels
  BEFORE INSERT OR UPDATE OF kind, parent_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_projects_two_levels();

--> statement-breakpoint

ALTER TABLE public.project_members
  ADD COLUMN title text,
  ADD COLUMN show_on_profile boolean NOT NULL DEFAULT true,
  ADD COLUMN last_seen_updates_at timestamptz,
  ADD COLUMN unit_id uuid REFERENCES public.project_open_roles(id) ON DELETE SET NULL,
  ADD CONSTRAINT project_members_title_length CHECK (title IS NULL OR char_length(title) <= 60);

--> statement-breakpoint

CREATE INDEX project_members_unit_idx ON public.project_members(unit_id) WHERE unit_id IS NOT NULL;

--> statement-breakpoint

CREATE TABLE public.org_join_blocks (
  org_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

--> statement-breakpoint

CREATE INDEX org_join_blocks_user_idx ON public.org_join_blocks(user_id);

--> statement-breakpoint

-- Invites to people without an account yet; matched by email at sign-up (report §20, §29.1).
CREATE TABLE public.org_email_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) <= 320),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  title text CHECK (title IS NULL OR char_length(title) <= 60),
  child_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.project_open_roles(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX org_email_invites_open_unique ON public.org_email_invites(org_id, email) WHERE accepted_at IS NULL;

--> statement-breakpoint

CREATE INDEX org_email_invites_email_idx ON public.org_email_invites(email) WHERE accepted_at IS NULL;

--> statement-breakpoint

-- Old handles redirect and stay taken for 90 days after a rename (report §30.2).
CREATE TABLE public.org_handle_holds (
  handle text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  held_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX org_handle_holds_org_idx ON public.org_handle_holds(org_id);

--> statement-breakpoint

-- Server-only tables: RLS on with no policies, no browser grants.
ALTER TABLE public.org_join_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_email_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_handle_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_join_blocks, public.org_email_invites, public.org_handle_holds FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_join_blocks, public.org_email_invites, public.org_handle_holds TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.org_join_blocks, public.org_email_invites, public.org_handle_holds TO service_role;
  END IF;
END $$;

--> statement-breakpoint

-- The caller's role in an org: 'owner' (projects.owner_id) or their project_members role; NULL outside it.
CREATE FUNCTION app_private.nb_org_role(p_org_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN o.owner_id = (SELECT auth.uid()) THEN 'owner' ELSE pm.role END
  FROM public.projects o
  LEFT JOIN public.project_members pm ON pm.project_id = o.id AND pm.user_id = (SELECT auth.uid())
  WHERE o.id = p_org_id AND o.kind = 'organization' AND o.deleted_at IS NULL;
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_org_role(uuid) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app_private.nb_org_role(uuid) TO anon, authenticated, service_role;

--> statement-breakpoint

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
        OR (p.parent_id IS NOT NULL AND (
          app_private.nb_org_role(p.parent_id) IN ('owner', 'admin')
          OR (p.visibility = 'org' AND coalesce(p.status::text, 'draft') <> 'draft' AND app_private.nb_org_role(p.parent_id) IS NOT NULL)
        ))
      )
  );
$$;

--> statement-breakpoint

-- Owners, members and inherited org admins see every tab; public and Org only readers need the tab switched on.
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

CREATE OR REPLACE FUNCTION app_private.nb_project_can_write(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.deleted_at IS NULL
      AND (
        p.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.project_members pm
          WHERE pm.project_id = p_project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'member')
        )
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
      )
  );
$$;
