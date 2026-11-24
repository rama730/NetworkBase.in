-- Plan B2.1a (report 31.2 C1): programs — a school's saved class plan. A program points to the cohort it was saved
-- from (call); Start a cohort runs the existing duplicate from it with a new start, seats and join method, and the new
-- class carries the program's id in its settings. Running cohorts never change on their own. Server only.

CREATE TABLE public.programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    institution_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    weeks integer,
    status text DEFAULT 'active' NOT NULL,
    source_class_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
    seats integer,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programs_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT programs_status_check CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT programs_weeks_check CHECK (weeks IS NULL OR weeks BETWEEN 1 AND 104),
    CONSTRAINT programs_seats_check CHECK (seats IS NULL OR seats BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE INDEX programs_institution_idx ON public.programs (institution_id);
--> statement-breakpoint
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.programs FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.programs TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.programs TO service_role;
