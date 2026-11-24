-- Workflow tabs A7.6–A7.7 (report 38.18 O3, calls 1–2): a learning path's steps are sprints whose dates are optional
-- (both or neither; undated ones never auto-start because start_date <= now is never true for them), placed by
-- path_position; each person ticks lessons done for themselves in lesson_progress (server only).

ALTER TABLE public.workspace_sprints ALTER COLUMN start_date DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints ALTER COLUMN end_date DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints ADD CONSTRAINT workspace_sprints_dates_both_or_neither CHECK ((start_date IS NULL) = (end_date IS NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints VALIDATE CONSTRAINT workspace_sprints_dates_both_or_neither;
--> statement-breakpoint
ALTER TABLE public.workspace_sprints ADD COLUMN path_position integer;
--> statement-breakpoint
CREATE TABLE public.lesson_progress (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    done_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (task_id, user_id)
);
--> statement-breakpoint
CREATE INDEX lesson_progress_user_idx ON public.lesson_progress (user_id, done_at DESC);
--> statement-breakpoint
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lesson_progress FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lesson_progress TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lesson_progress TO service_role;
