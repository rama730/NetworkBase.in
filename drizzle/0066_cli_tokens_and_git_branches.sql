-- High-EQ CLI, Personal Access Tokens (nb_pat_), Git Branches/Commits, and CLI File Leases
ALTER TABLE public.workspace_node_locks
    DROP CONSTRAINT IF EXISTS workspace_node_locks_client_kind_check;
--> statement-breakpoint
ALTER TABLE public.workspace_node_locks
    ADD CONSTRAINT workspace_node_locks_client_kind_check
    CHECK ((client_kind = ANY (ARRAY['web'::text, 'vscode'::text, 'cli'::text])));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.personal_access_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    label text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    scopes jsonb DEFAULT '["repo:read", "repo:write", "task:write"]'::jsonb NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT personal_access_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT personal_access_tokens_token_hash_unique UNIQUE (token_hash)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS personal_access_tokens_user_idx ON public.personal_access_tokens (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS personal_access_tokens_hash_idx ON public.personal_access_tokens (token_hash);
--> statement-breakpoint
ALTER TABLE public.personal_access_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.personal_access_tokens FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.personal_access_tokens TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.personal_access_tokens TO service_role;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.workspace_git_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    branch_name text NOT NULL,
    head_commit_sha text NOT NULL,
    is_protected boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_git_branches_pkey PRIMARY KEY (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_git_branches_ws_branch_idx ON public.workspace_git_branches (workspace_id, branch_name);
--> statement-breakpoint
ALTER TABLE public.workspace_git_branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_git_branches FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_git_branches TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_git_branches TO service_role;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.workspace_git_commits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    commit_sha text NOT NULL,
    parent_sha text,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    author_name text NOT NULL,
    author_email text NOT NULL,
    message text NOT NULL,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    file_role text DEFAULT 'working'::text NOT NULL,
    files_changed_count integer DEFAULT 0 NOT NULL,
    committed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_git_commits_pkey PRIMARY KEY (id),
    CONSTRAINT workspace_git_commits_commit_sha_unique UNIQUE (commit_sha)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_git_commits_ws_idx ON public.workspace_git_commits (workspace_id, committed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_git_commits_task_idx ON public.workspace_git_commits (task_id);
--> statement-breakpoint
ALTER TABLE public.workspace_git_commits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_git_commits FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_git_commits TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_git_commits TO service_role;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.workspace_branch_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    pattern text NOT NULL,
    prevent_force_push boolean DEFAULT true NOT NULL,
    require_review boolean DEFAULT true NOT NULL,
    allowed_roles jsonb DEFAULT '["owner", "admin"]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_branch_rules_pkey PRIMARY KEY (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_branch_rules_ws_idx ON public.workspace_branch_rules (workspace_id);
--> statement-breakpoint
ALTER TABLE public.workspace_branch_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_branch_rules FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_branch_rules TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_branch_rules TO service_role;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.workspace_webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    target_url text NOT NULL,
    secret_hash text NOT NULL,
    events jsonb DEFAULT '["git.push", "task.review"]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_webhooks_pkey PRIMARY KEY (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_webhooks_ws_idx ON public.workspace_webhooks (workspace_id);
--> statement-breakpoint
ALTER TABLE public.workspace_webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_webhooks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_webhooks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_webhooks TO service_role;
