-- Plan B5.4b (report 34.5 calls 4–6, 9): a challenge entry's showcase card — the maker's title, line and cover alt,
-- an organiser's Featured pick with its "Why we love it" line (no scores or ranks), and the maker's yes to the public
-- Showcase (a team entry needs every member). Kept apart from the task so no task-field write can set them. Server only.

CREATE TABLE public.community_showcase (
    copy_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    title text,
    line text,
    public_yes uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    featured_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    featured_at timestamp with time zone,
    why text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_showcase_title CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT community_showcase_line CHECK (line IS NULL OR char_length(line) <= 200),
    CONSTRAINT community_showcase_why CHECK (why IS NULL OR char_length(why) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX community_showcase_workspace_idx ON public.community_showcase (workspace_id, featured_at DESC NULLS LAST, updated_at DESC);
--> statement-breakpoint
CREATE INDEX community_showcase_featured_by_idx ON public.community_showcase (featured_by) WHERE featured_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.community_showcase ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.community_showcase FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_showcase TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.community_showcase TO service_role;
