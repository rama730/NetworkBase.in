-- CLI 2.0 Phase 3 (report A7.11, A9.7, §44): what was made through the CLI or an AI agent, so the app can show
-- "via Claude Code" next to versions, tasks, subtasks, comments and pushes. NULL = made in the app.
ALTER TABLE public.file_versions ADD COLUMN via text, ADD COLUMN agent_name text,
    ADD CONSTRAINT file_versions_via_check CHECK (via IS NULL OR via = ANY (ARRAY['cli'::text, 'agent'::text]));
--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN via text, ADD COLUMN agent_name text,
    ADD CONSTRAINT tasks_via_check CHECK (via IS NULL OR via = ANY (ARRAY['cli'::text, 'agent'::text]));
--> statement-breakpoint
ALTER TABLE public.task_subtasks ADD COLUMN via text, ADD COLUMN agent_name text,
    ADD CONSTRAINT task_subtasks_via_check CHECK (via IS NULL OR via = ANY (ARRAY['cli'::text, 'agent'::text]));
--> statement-breakpoint
ALTER TABLE public.task_comments ADD COLUMN via text, ADD COLUMN agent_name text,
    ADD CONSTRAINT task_comments_via_check CHECK (via IS NULL OR via = ANY (ARRAY['cli'::text, 'agent'::text]));
--> statement-breakpoint
ALTER TABLE public.workspace_git_commits ADD COLUMN via text, ADD COLUMN agent_name text,
    ADD CONSTRAINT workspace_git_commits_via_check CHECK (via IS NULL OR via = ANY (ARRAY['cli'::text, 'agent'::text]));
