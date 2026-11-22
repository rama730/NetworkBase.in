-- Profile mix (2026-11-23 spec, Portfolio): workspaces you pinned to the top of your portfolio. Read and written by
-- the server only, like sidebar_pins (0065).
CREATE TABLE public.profile_portfolio_pins (
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profile_portfolio_pins_pkey PRIMARY KEY (profile_id, workspace_id)
);
--> statement-breakpoint
CREATE INDEX profile_portfolio_pins_workspace_idx ON public.profile_portfolio_pins (workspace_id);
--> statement-breakpoint
ALTER TABLE public.profile_portfolio_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.profile_portfolio_pins FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_portfolio_pins TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.profile_portfolio_pins TO service_role;
