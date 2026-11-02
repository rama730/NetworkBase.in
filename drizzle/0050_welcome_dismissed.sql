-- Report §26.7, decision 49 (DB4): the welcome panel shows once after joining; × hides it on every device.
-- People already in an organization never see it, so their memberships start dismissed.
ALTER TABLE public.workspace_members ADD COLUMN welcome_dismissed_at timestamptz;
--> statement-breakpoint
UPDATE public.workspace_members m SET welcome_dismissed_at = now()
FROM public.workspaces w WHERE w.id = m.workspace_id AND w.kind = 'organization';
