-- Org invites, handle holds, join blocks.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_org_role(p_org_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN o.owner_id = (SELECT auth.uid()) THEN 'owner' ELSE pm.role END
  FROM public.workspaces o
  LEFT JOIN public.workspace_members pm ON pm.workspace_id = o.id AND pm.user_id = (SELECT auth.uid())
  WHERE o.id = p_org_id AND o.kind = 'organization' AND o.deleted_at IS NULL;
$$;
--> statement-breakpoint
CREATE TABLE public.org_email_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    title text,
    child_workspace_id uuid,
    unit_id uuid,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_email_invites_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 320))),
    CONSTRAINT org_email_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'viewer'::text]))),
    CONSTRAINT org_email_invites_title_check CHECK (((title IS NULL) OR (char_length(title) <= 60)))
);
--> statement-breakpoint
CREATE TABLE public.org_handle_holds (
    handle text NOT NULL,
    org_id uuid NOT NULL,
    held_until timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.org_join_blocks (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    blocked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.org_email_invites
    ADD CONSTRAINT org_email_invites_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.org_handle_holds
    ADD CONSTRAINT org_handle_holds_pkey PRIMARY KEY (handle);
--> statement-breakpoint
ALTER TABLE ONLY public.org_join_blocks
    ADD CONSTRAINT org_join_blocks_pkey PRIMARY KEY (org_id, user_id);
--> statement-breakpoint
CREATE INDEX org_email_invites_child_workspace_idx ON public.org_email_invites USING btree (child_workspace_id) WHERE (child_workspace_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX org_email_invites_email_idx ON public.org_email_invites USING btree (email) WHERE (accepted_at IS NULL);
--> statement-breakpoint
CREATE INDEX org_email_invites_invited_by_idx ON public.org_email_invites USING btree (invited_by) WHERE (invited_by IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX org_email_invites_open_unique ON public.org_email_invites USING btree (org_id, email) WHERE (accepted_at IS NULL);
--> statement-breakpoint
CREATE INDEX org_email_invites_org_idx ON public.org_email_invites USING btree (org_id);
--> statement-breakpoint
CREATE INDEX org_email_invites_unit_idx ON public.org_email_invites USING btree (unit_id) WHERE (unit_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX org_handle_holds_org_idx ON public.org_handle_holds USING btree (org_id);
--> statement-breakpoint
CREATE INDEX org_join_blocks_blocked_by_idx ON public.org_join_blocks USING btree (blocked_by) WHERE (blocked_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX org_join_blocks_user_idx ON public.org_join_blocks USING btree (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.org_email_invites
    ADD CONSTRAINT org_email_invites_child_workspace_id_fkey FOREIGN KEY (child_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.org_email_invites
    ADD CONSTRAINT org_email_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.org_email_invites
    ADD CONSTRAINT org_email_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.org_email_invites
    ADD CONSTRAINT org_email_invites_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.workspace_open_roles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.org_handle_holds
    ADD CONSTRAINT org_handle_holds_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.org_join_blocks
    ADD CONSTRAINT org_join_blocks_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.org_join_blocks
    ADD CONSTRAINT org_join_blocks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.org_join_blocks
    ADD CONSTRAINT org_join_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.org_email_invites TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.org_handle_holds TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.org_join_blocks TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.org_email_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_handle_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_join_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_org_role(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_org_role(p_org_id uuid) TO anon;
GRANT ALL ON FUNCTION app_private.nb_org_role(p_org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_org_role(p_org_id uuid) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_org_role(p_org_id uuid) TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.org_email_invites TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.org_email_invites TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.org_handle_holds TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.org_handle_holds TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.org_join_blocks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.org_join_blocks TO nb_app;
