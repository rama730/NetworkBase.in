-- Plan B1.5a (report 30.8 W7): one mark per assignment copy — the total and its out-of, the rubric levels picked,
-- a comment, who marked it and when. A mark is a hidden draft until the copy is approved (visible_at); Return keeps
-- it hidden (call 5). Seen only by the student and the staff who review it. Server only (no browser grants).

CREATE TABLE public.assignment_marks (
    copy_id uuid NOT NULL PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
    master_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    total numeric(8,2) NOT NULL,
    out_of numeric(8,2) NOT NULL,
    levels jsonb DEFAULT '{}'::jsonb NOT NULL,
    comment text,
    marker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    visible_at timestamp with time zone,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT assignment_marks_total_check CHECK (total >= 0 AND out_of > 0 AND total <= out_of),
    CONSTRAINT assignment_marks_comment_length CHECK (comment IS NULL OR char_length(comment) <= 2000)
);
--> statement-breakpoint
CREATE INDEX assignment_marks_master_idx ON public.assignment_marks (master_id);
--> statement-breakpoint
ALTER TABLE public.assignment_marks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.assignment_marks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_marks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.assignment_marks TO service_role;
