-- Report C2, C3, C12 (M4b): task labels, "blocked by", watching a task, starred tasks and files, and links on a task
-- (pull requests first). Labels live on the task; the rest are small join tables read through the server.
ALTER TABLE public.tasks ADD COLUMN labels text[] DEFAULT '{}'::text[] NOT NULL,
    ADD CONSTRAINT tasks_labels_limit CHECK (cardinality(labels) <= 20);
--> statement-breakpoint
CREATE INDEX tasks_labels_gin_idx ON public.tasks USING gin (labels) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- The task panel reads tasks directly with a column grant (0086); labels join it.
GRANT SELECT (labels) ON public.tasks TO anon, authenticated;
--> statement-breakpoint
CREATE TABLE public.task_dependencies (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    blocked_by_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (task_id, blocked_by_task_id),
    CONSTRAINT task_dependencies_not_self CHECK (task_id <> blocked_by_task_id)
);
--> statement-breakpoint
CREATE INDEX task_dependencies_blocked_by_idx ON public.task_dependencies (blocked_by_task_id);
--> statement-breakpoint
CREATE INDEX task_dependencies_created_by_idx ON public.task_dependencies (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.task_watchers (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (task_id, user_id)
);
--> statement-breakpoint
CREATE INDEX task_watchers_user_idx ON public.task_watchers (user_id);
--> statement-breakpoint
CREATE TABLE public.task_stars (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (task_id, user_id)
);
--> statement-breakpoint
CREATE INDEX task_stars_user_idx ON public.task_stars (user_id);
--> statement-breakpoint
CREATE TABLE public.node_stars (
    node_id uuid NOT NULL REFERENCES public.workspace_nodes(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (node_id, user_id)
);
--> statement-breakpoint
CREATE INDEX node_stars_user_idx ON public.node_stars (user_id);
--> statement-breakpoint
CREATE TABLE public.task_links (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    url text NOT NULL,
    title text,
    kind text DEFAULT 'link'::text NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_links_url_check CHECK (char_length(url) <= 2000 AND url ~ '^https://'),
    CONSTRAINT task_links_title_length CHECK (title IS NULL OR char_length(title) <= 300),
    CONSTRAINT task_links_kind_check CHECK (kind = ANY (ARRAY['pull_request'::text, 'issue'::text, 'link'::text])),
    CONSTRAINT task_links_task_url_unique UNIQUE (task_id, url)
);
--> statement-breakpoint
CREATE INDEX task_links_created_by_idx ON public.task_links (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_watchers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_stars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.node_stars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.task_dependencies, public.task_watchers, public.task_stars, public.node_stars, public.task_links FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_dependencies, public.task_watchers, public.task_stars, public.node_stars, public.task_links TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.task_dependencies, public.task_watchers, public.task_stars, public.node_stars, public.task_links TO service_role;
