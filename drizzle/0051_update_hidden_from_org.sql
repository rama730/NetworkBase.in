-- Report §37.3, decision 100 (DB6): an organization admin hides a workspace's shared post from the organization's feed.
-- The post stays in its workspace; only the organization's feed and pins drop it.
ALTER TABLE public.workspace_updates ADD COLUMN hidden_from_org_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.workspace_updates ADD COLUMN hidden_from_org_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
