-- The last access a person chose for each agent name (report A5): the next approval for that agent is pre-filled,
-- so approving again is one click. workspace_id NULL means "All my workspaces".

CREATE TABLE public.agent_access_defaults (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_name text NOT NULL,
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
    access text NOT NULL,
    expiry_days integer NOT NULL,
    extra_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, agent_name),
    CONSTRAINT agent_access_defaults_access_check CHECK (access = ANY (ARRAY['full'::text, 'small'::text, 'read'::text, 'custom'::text])),
    CONSTRAINT agent_access_defaults_expiry_check CHECK (expiry_days = ANY (ARRAY[7, 30, 90])),
    CONSTRAINT agent_access_defaults_name_length CHECK (char_length(agent_name) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE public.agent_access_defaults ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agent_access_defaults FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_access_defaults TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.agent_access_defaults TO service_role;
