-- Plan B1.6b (report 30.5 call 3): extra time per student in a class, in minutes. It moves only that student's close
-- on timed and take-home exams. Private to staff and that student. Server only (no browser grants).

CREATE TABLE public.exam_extra_time (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    minutes integer NOT NULL,
    set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT exam_extra_time_minutes CHECK (minutes BETWEEN 1 AND 600)
);
--> statement-breakpoint
ALTER TABLE public.exam_extra_time ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.exam_extra_time FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.exam_extra_time TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.exam_extra_time TO service_role;
