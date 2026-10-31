-- Views per workspace per UTC day, split by signed-in and anonymous. Totals only, never who viewed. The server reads and writes them; browsers get nothing.
CREATE TABLE public.workspace_view_daily (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    day date NOT NULL,
    signed_in_views integer DEFAULT 0 NOT NULL,
    anonymous_views integer DEFAULT 0 NOT NULL,
    CONSTRAINT workspace_view_daily_pkey PRIMARY KEY (workspace_id, day),
    CONSTRAINT workspace_view_daily_counts_check CHECK (signed_in_views >= 0 AND anonymous_views >= 0)
);
--> statement-breakpoint
ALTER TABLE public.workspace_view_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_view_daily FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.workspace_view_daily TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_view_daily TO service_role;
