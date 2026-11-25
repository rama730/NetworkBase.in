-- Plan B3.5b (report 32.6 S5 calls 4, 5, 8): each person's growth record at a school — up to 3 goals a year, one
-- year review (self-reflection, the line manager's part, a development plan; words only, no ratings, scores or pay)
-- and the development log. Read by the person and their line manager only; leaders see counts. Server only.

CREATE TABLE public.staff_growth (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind text NOT NULL,
    year text NOT NULL,
    title text NOT NULL,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_growth_kind CHECK (kind IN ('goal', 'review', 'log')),
    CONSTRAINT staff_growth_year CHECK (year ~ '^[0-9]{4}$'),
    CONSTRAINT staff_growth_title_length CHECK (char_length(title) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX staff_growth_person_idx ON public.staff_growth (workspace_id, user_id, year);
--> statement-breakpoint
CREATE UNIQUE INDEX staff_growth_one_review ON public.staff_growth (workspace_id, user_id, year) WHERE kind = 'review';
--> statement-breakpoint
ALTER TABLE public.staff_growth ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.staff_growth FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_growth TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.staff_growth TO service_role;
