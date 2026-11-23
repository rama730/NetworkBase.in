-- Member settings and completing your part (docs/superpowers/plans/2026-11-12-member-settings-concept.md §6).
-- A member can complete their part (they stay a member, read-only), reopen it, and keep their own settings for the
-- workspace. Finished periods are kept so reopening or rejoining never rewrites earlier dates.

-- Your part and your settings live on the membership row (the one source of truth, §1).
ALTER TABLE public.workspace_members
    ADD COLUMN completed_at timestamp with time zone,
    ADD COLUMN completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN completion_note text,
    ADD COLUMN completion_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN completion_confirmed_at timestamp with time zone,
    ADD COLUMN hide_agent_label boolean DEFAULT false NOT NULL,
    ADD COLUMN agents_blocked_at timestamp with time zone,
    ADD COLUMN view_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    ADD CONSTRAINT workspace_members_completion_note_length CHECK (completion_note IS NULL OR char_length(completion_note) <= 280);
--> statement-breakpoint
CREATE INDEX workspace_members_active_idx ON public.workspace_members (workspace_id) WHERE completed_at IS NULL;
--> statement-breakpoint
-- One row per finished period (completed, left, removed, workspace completed). Append-only; server only.
CREATE TABLE public.workspace_member_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    end_reason text NOT NULL,
    note text,
    ended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_member_periods_reason_check CHECK (end_reason = ANY (ARRAY['completed'::text, 'workspace_completed'::text, 'left'::text, 'removed'::text])),
    CONSTRAINT workspace_member_periods_note_length CHECK (note IS NULL OR char_length(note) <= 280)
);
--> statement-breakpoint
CREATE INDEX workspace_member_periods_person_idx ON public.workspace_member_periods (workspace_id, user_id, ended_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_member_periods_user_idx ON public.workspace_member_periods (user_id, ended_at DESC);
--> statement-breakpoint
ALTER TABLE public.workspace_member_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_member_periods FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_member_periods TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_member_periods TO service_role;
--> statement-breakpoint
-- Profile stages: completing closes the open stage; reopening starts a new one.
ALTER TABLE public.profile_contribution_stages DROP CONSTRAINT profile_contribution_stages_source_check;
--> statement-breakpoint
ALTER TABLE public.profile_contribution_stages ADD CONSTRAINT profile_contribution_stages_source_check CHECK ((source = ANY (ARRAY['membership'::text, 'application'::text, 'owner'::text, 'manual'::text, 'role_change'::text, 'workspace_invite'::text, 'ownership_transfer'::text, 'removal'::text, 'backfill'::text, 'completion'::text, 'reopen'::text])));
--> statement-breakpoint
-- The owner lets members hide "with Claude Code" on their own work (Part 1); Roles (Part 4): null = today's rules.
ALTER TABLE public.workspaces
    ADD COLUMN members_choose_labels boolean DEFAULT false NOT NULL,
    ADD COLUMN role_abilities jsonb;
--> statement-breakpoint
-- Read-only after completing your part, in SQL too (§1.3): the app's resolver mirrors this.
CREATE OR REPLACE FUNCTION app_private.nb_workspace_can_write(p_project_id uuid) RETURNS boolean
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
            AND pm.completed_at IS NULL
        )
        OR (p.parent_id IS NOT NULL AND app_private.nb_org_role(p.parent_id) IN ('owner', 'admin'))
      )
  );
$$;
--> statement-breakpoint
DROP POLICY file_versions_insert_workspace_member ON public.file_versions;
--> statement-breakpoint
CREATE POLICY file_versions_insert_workspace_member ON public.file_versions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.workspace_nodes pn
     JOIN public.workspaces p ON ((pn.workspace_id = p.id)))
  WHERE ((pn.id = file_versions.node_id) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role <> 'viewer'::text) AND (m.completed_at IS NULL)))))))));
