-- Plan B2.4a (report 31.4 C3): mock tests. A mock is an Exam assignment with a Score layout (in its settings);
-- staff enter each learner's section marks once (held results stay hidden until released); each learner keeps their
-- own exam, date and targets (staff may suggest targets). Learners see only their own; staff see bands. Server only.

CREATE TABLE public.mock_scores (
    master_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    raws jsonb DEFAULT '{}'::jsonb NOT NULL,
    entered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (master_id, user_id)
);
--> statement-breakpoint
CREATE INDEX mock_scores_learner_idx ON public.mock_scores (workspace_id, user_id);
--> statement-breakpoint
CREATE TABLE public.prep_profiles (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    exam_name text,
    exam_date date,
    targets jsonb DEFAULT '{}'::jsonb NOT NULL,
    suggested jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT prep_profiles_exam_name_length CHECK (exam_name IS NULL OR char_length(exam_name) <= 80)
);
--> statement-breakpoint
ALTER TABLE public.mock_scores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.prep_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.mock_scores, public.prep_profiles FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mock_scores, public.prep_profiles TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.mock_scores, public.prep_profiles TO service_role;
