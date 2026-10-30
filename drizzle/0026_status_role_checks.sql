-- These columns were plain text, so a typo would be saved. Each rule allows exactly the values the code declares in src/lib/db/schema.
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspace_members VALIDATE CONSTRAINT workspace_members_role_check;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_visibility_check CHECK (visibility IN ('public', 'private', 'unlisted', 'org')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspaces VALIDATE CONSTRAINT workspaces_visibility_check;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_sync_status_check CHECK (sync_status IN ('pending', 'cloning', 'indexing', 'ready', 'failed')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspaces VALIDATE CONSTRAINT workspaces_sync_status_check;
--> statement-breakpoint
ALTER TABLE public.tasks ADD CONSTRAINT tasks_review_status_check CHECK (review_status IN ('none', 'pending', 'rejected')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_review_status_check;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts ADD CONSTRAINT workspace_update_drafts_visibility_check CHECK (visibility IN ('public', 'members')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts VALIDATE CONSTRAINT workspace_update_drafts_visibility_check;
--> statement-breakpoint
ALTER TABLE public.profile_skills ADD CONSTRAINT profile_skills_visibility_check CHECK (visibility IN ('public', 'connections', 'private')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.profile_skills VALIDATE CONSTRAINT profile_skills_visibility_check;
--> statement-breakpoint
ALTER TABLE public.upload_intents ADD CONSTRAINT upload_intents_kind_check CHECK (kind IN ('file', 'avatar', 'banner', 'cover', 'draft', 'manifest', 'snapshot')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.upload_intents VALIDATE CONSTRAINT upload_intents_kind_check;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes ADD CONSTRAINT workspace_nodes_type_check CHECK (type IN ('folder', 'file')) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspace_nodes VALIDATE CONSTRAINT workspace_nodes_type_check;
