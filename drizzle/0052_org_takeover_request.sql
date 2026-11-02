-- Report §45.2, decision 170 (DB12): an admin asks to take over an organization whose owner has been away 30 days.
-- One request at a time; the owner refuses within 7 days or the admin may take over. Checked when Settings opens.
ALTER TABLE public.workspaces ADD COLUMN takeover_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD COLUMN takeover_requested_at timestamptz;
