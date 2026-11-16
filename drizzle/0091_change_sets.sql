-- Report Part G (M5): change sets. An agent's multi-file job is one named piece of work: its items wait here, are
-- reviewed, apply in one transaction, and undo in one step. Applied items become ordinary file versions that point
-- back to the change set. Server-only tables: every read and write goes through src/lib/domain/change-sets.ts.
CREATE TABLE IF NOT EXISTS public.change_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    author_id uuid NOT NULL REFERENCES public.profiles(id),
    via text CHECK (via IN ('cli', 'agent')),
    agent_name text,
    agent_session_id uuid REFERENCES public.extension_device_sessions(id) ON DELETE SET NULL,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    message text CHECK (message IS NULL OR char_length(message) <= 2000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ready', 'applying', 'applied', 'discarded', 'undone')),
    files_added integer NOT NULL DEFAULT 0,
    files_changed integer NOT NULL DEFAULT 0,
    files_deleted integer NOT NULL DEFAULT 0,
    files_renamed integer NOT NULL DEFAULT 0,
    lines_added integer NOT NULL DEFAULT 0,
    lines_removed integer NOT NULL DEFAULT 0,
    bytes bigint NOT NULL DEFAULT 0,
    apply_result jsonb,
    undo_operation_id uuid REFERENCES public.undo_operations(id) ON DELETE SET NULL,
    applied_by uuid REFERENCES public.profiles(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    ready_at timestamp with time zone,
    applied_at timestamp with time zone,
    discarded_at timestamp with time zone,
    undone_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_sets_workspace_status_idx ON public.change_sets (workspace_id, status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_sets_author_open_idx ON public.change_sets (author_id, status) WHERE status IN ('open', 'ready');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_sets_task_idx ON public.change_sets (task_id) WHERE task_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.change_set_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id uuid NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
    op text NOT NULL CHECK (op IN ('add', 'change', 'delete', 'rename')),
    path text NOT NULL CHECK (path LIKE '/%' AND char_length(path) <= 1024),
    from_path text CHECK (from_path IS NULL OR (from_path LIKE '/%' AND char_length(from_path) <= 1024)),
    base_node_id uuid REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
    base_version integer,
    base_hash text,
    content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
    asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL,
    size bigint,
    mime_type text,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'merged', 'conflict', 'applied')),
    merged_asset_id uuid REFERENCES public.storage_assets(id) ON DELETE SET NULL,
    conflict jsonb,
    lines_added integer,
    lines_removed integer,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT change_set_items_rename_from CHECK ((op = 'rename') = (from_path IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS change_set_items_path_unique ON public.change_set_items (change_set_id, path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_set_items_state_idx ON public.change_set_items (change_set_id, state);
--> statement-breakpoint
ALTER TABLE public.file_versions ADD COLUMN IF NOT EXISTS change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS file_versions_change_set_idx ON public.file_versions (change_set_id) WHERE change_set_id IS NOT NULL;
--> statement-breakpoint
-- G23: change sets are turned on per workspace first (the user's own), then for everyone.
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS change_sets_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.change_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.change_set_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.change_sets, public.change_set_items FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_sets, public.change_set_items TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.change_sets, public.change_set_items TO service_role;
