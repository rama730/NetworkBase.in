-- Report §42.5, decision 127, problem 9 (DB9): each hand-in is kept as a version and locked: its link or text, an
-- optional note, and the files with the version each had. Admins read it through the server; browsers never do.
CREATE TABLE public.assignment_submissions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    copy_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    version integer NOT NULL,
    submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    link text,
    body text,
    note text,
    files jsonb DEFAULT '[]'::jsonb NOT NULL,
    late boolean DEFAULT false NOT NULL,
    CONSTRAINT assignment_submissions_version_check CHECK (version >= 1),
    CONSTRAINT assignment_submissions_note_check CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT assignment_submissions_copy_version_key UNIQUE (copy_id, version)
);
--> statement-breakpoint
CREATE INDEX assignment_submissions_workspace_idx ON public.assignment_submissions USING btree (workspace_id, submitted_at DESC);
--> statement-breakpoint
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.assignment_submissions FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.assignment_submissions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.assignment_submissions TO service_role;
--> statement-breakpoint
-- Decision 126 and smaller bug 18: a copy can be handed in until this, past its due date and after Close (Fix by on
-- Return, or reopened for one person).
ALTER TABLE public.tasks ADD COLUMN submit_until timestamp with time zone;
