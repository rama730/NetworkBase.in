-- Report §29.4 and decision 62: admins see when someone was last active in this organization, never account-wide.
-- Stamped at most hourly when they open the organization or one of its workspaces. Empty means "No data yet".
ALTER TABLE public.workspace_members ADD COLUMN last_active_here_at timestamp with time zone;
--> statement-breakpoint
-- Admins read it through the server; browsers never do.
REVOKE SELECT (last_active_here_at), INSERT (last_active_here_at), UPDATE (last_active_here_at) ON public.workspace_members FROM anon, authenticated;
