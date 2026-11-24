-- Plan B1.5c (report 30.8 call: peer review): each student who has handed in reviews 2 other hand-ins of the same
-- assignment with its rubric; names are hidden both ways; feedback, not marks. Server only (no browser grants).

CREATE TABLE public.peer_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    master_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    copy_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    levels jsonb DEFAULT '{}'::jsonb NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    CONSTRAINT peer_reviews_one_each UNIQUE (copy_id, reviewer_id),
    CONSTRAINT peer_reviews_comment_length CHECK (comment IS NULL OR char_length(comment) <= 2000)
);
--> statement-breakpoint
CREATE INDEX peer_reviews_master_reviewer_idx ON public.peer_reviews (master_id, reviewer_id);
--> statement-breakpoint
ALTER TABLE public.peer_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.peer_reviews FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.peer_reviews TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.peer_reviews TO service_role;
