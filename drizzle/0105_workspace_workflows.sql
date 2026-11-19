-- Workflow tabs F1 (report 38.2, plan A0.2): the workflows a workspace added. Remove hides a row (call 4); adding again
-- clears hidden_at. An organization's row with push_to_children reaches every child workspace (A0.3). Server-only:
-- the app reads it as nb_app, nothing in the browser queries it.
CREATE TABLE IF NOT EXISTS public.workspace_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow text NOT NULL,
  push_to_children boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workspace_workflows_workspace_workflow_key ON public.workspace_workflows (workspace_id, workflow);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_workflows_added_by_idx ON public.workspace_workflows (added_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_workflows_hidden_by_idx ON public.workspace_workflows (hidden_by);
--> statement-breakpoint
ALTER TABLE public.workspace_workflows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_workflows FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_workflows TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_workflows TO service_role;
