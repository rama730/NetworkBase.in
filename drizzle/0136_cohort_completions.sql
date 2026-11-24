-- Plan B2.1b (report 31.2 C1 calls 5–6): a cohort's completion, one row per learner, recorded by staff after the
-- end date. The rule (every required assignment approved, attendance at or above the minimum when it's on) is worked
-- out on the server; staff may override it with a reason. Completed also verifies the learner's profile entry.
-- The learner and the cohort's staff read it; the school sees counts only. Server only.

CREATE TABLE public.cohort_completions (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    completed boolean NOT NULL,
    by_rule boolean NOT NULL,
    override_reason text,
    decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT cohort_completions_reason_check CHECK (by_rule OR char_length(coalesce(override_reason, '')) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE public.cohort_completions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.cohort_completions FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_completions TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.cohort_completions TO service_role;
