-- Left navigation → Workspaces (2026-11-05-sidebar-workspaces-findings.md §3a): G4 orders the list by your own visits,
-- so a workspace someone else edits doesn't jump; G9 pins workspaces to the top of your list on every device.
ALTER TABLE public.workspace_members ADD COLUMN last_opened_at timestamp with time zone;
--> statement-breakpoint
CREATE TABLE public.sidebar_pins (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sidebar_pins_pkey PRIMARY KEY (user_id, workspace_id)
);
--> statement-breakpoint
CREATE INDEX sidebar_pins_workspace_idx ON public.sidebar_pins (workspace_id);
--> statement-breakpoint
ALTER TABLE public.sidebar_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.sidebar_pins FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sidebar_pins TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.sidebar_pins TO service_role;
