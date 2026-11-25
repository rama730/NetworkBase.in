-- Plan B3.5c (report 32.6 S5 calls 6–8): observations — booked on a day (and timetable slot) with notice, a focus,
-- then Strengths and One next step; feedback only. The observed teacher reads it first; then their line manager
-- (unless it's a peer observation kept between the two). Leaders see counts. Server only.

CREATE TABLE public.staff_observations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    observer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    observed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slot_id uuid REFERENCES public.school_timetable_slots(id) ON DELETE SET NULL,
    day date NOT NULL,
    focus text NOT NULL,
    strengths text,
    next_step text,
    just_between_us boolean DEFAULT false NOT NULL,
    state text DEFAULT 'booked' NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_observations_state CHECK (state IN ('booked', 'written')),
    CONSTRAINT staff_observations_focus_length CHECK (char_length(focus) BETWEEN 1 AND 300),
    CONSTRAINT staff_observations_text_length CHECK ((strengths IS NULL OR char_length(strengths) <= 3000) AND (next_step IS NULL OR char_length(next_step) <= 1000)),
    CONSTRAINT staff_observations_not_self CHECK (observer_id <> observed_id)
);
--> statement-breakpoint
CREATE INDEX staff_observations_workspace_idx ON public.staff_observations (workspace_id, day);
--> statement-breakpoint
CREATE INDEX staff_observations_observed_idx ON public.staff_observations (observed_id);
--> statement-breakpoint
ALTER TABLE public.staff_observations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.staff_observations FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_observations TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.staff_observations TO service_role;
