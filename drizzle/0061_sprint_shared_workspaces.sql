-- Live-fix 34 (report §37.2, owner decision 3 Nov 2026): "Share with workspaces: All, Selected or None". All is
-- show_in_children with no rows here; Selected is show_in_children plus one row per chosen workspace; None is off.
CREATE TABLE public.sprint_shared_workspaces (
    sprint_id uuid NOT NULL REFERENCES public.workspace_sprints(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT sprint_shared_workspaces_pkey PRIMARY KEY (sprint_id, workspace_id)
);
--> statement-breakpoint
CREATE INDEX sprint_shared_workspaces_workspace_idx ON public.sprint_shared_workspaces (workspace_id);
--> statement-breakpoint
ALTER TABLE public.sprint_shared_workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.sprint_shared_workspaces FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sprint_shared_workspaces TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.sprint_shared_workspaces TO service_role;
