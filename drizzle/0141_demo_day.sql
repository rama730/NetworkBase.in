-- Plan B2.5b (report 31.6 C4): demo day. Judges leave feedback per team (scores 1–5 and a note; feedback, never marks
-- or totals) and pick a team per award; staff announce. The demo day's details and run of show live in the class's
-- settings. Server only.

CREATE TABLE public.demo_feedback (
    team_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    judge_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (team_id, judge_id),
    CONSTRAINT demo_feedback_note_length CHECK (note IS NULL OR char_length(note) <= 2000)
);
--> statement-breakpoint
CREATE INDEX demo_feedback_workspace_idx ON public.demo_feedback (workspace_id);
--> statement-breakpoint
CREATE TABLE public.demo_picks (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    award text NOT NULL,
    judge_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, award, judge_id),
    CONSTRAINT demo_picks_award_length CHECK (char_length(award) BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE public.demo_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.demo_picks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.demo_feedback, public.demo_picks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.demo_feedback, public.demo_picks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.demo_feedback, public.demo_picks TO service_role;
