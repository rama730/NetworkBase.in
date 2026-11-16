-- Report C1, C15 (M4d): nb learn practises in a workspace made for it. A sandbox is a private workspace with an end
-- time; nb learn deletes it when the practice ends, and the daily sweep deletes one left behind after 24 hours.
ALTER TABLE public.workspaces ADD COLUMN sandbox_expires_at timestamp with time zone;
--> statement-breakpoint
CREATE INDEX workspaces_sandbox_expires_idx ON public.workspaces (sandbox_expires_at) WHERE sandbox_expires_at IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX workspaces_one_sandbox_per_owner ON public.workspaces (owner_id) WHERE sandbox_expires_at IS NOT NULL;
