-- Report G12 (M5): line comments in a change set's review, on a file and optionally a line of its new content.
CREATE TABLE IF NOT EXISTS public.change_set_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    change_set_id uuid NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
    path text NOT NULL CHECK (path LIKE '/%' AND char_length(path) <= 1024),
    line integer CHECK (line IS NULL OR line > 0),
    author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    resolved_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_set_comments_set_idx ON public.change_set_comments (change_set_id, path, created_at);
--> statement-breakpoint
ALTER TABLE public.change_set_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.change_set_comments FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_set_comments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.change_set_comments TO service_role;
