-- Plan B8.3a (report 37.5 calls 3–5): numbers typed for a program's measures. Each typed value is a row, kept as
-- history; it waits for an admin's Confirm before it reaches a report or About, and a later value never erases an
-- earlier one. A count only — no records of individual people served. Server only.

CREATE TABLE public.program_numbers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    program_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    measure_id text NOT NULL,
    value numeric(14,2) NOT NULL,
    note text NOT NULL DEFAULT '',
    state text DEFAULT 'waiting' NOT NULL,
    typed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    typed_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT program_numbers_state CHECK (state IN ('waiting', 'confirmed', 'declined')),
    CONSTRAINT program_numbers_value CHECK (value >= 0),
    CONSTRAINT program_numbers_text CHECK (char_length(measure_id) BETWEEN 1 AND 30 AND char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX program_numbers_program_idx ON public.program_numbers (program_id, measure_id, typed_at DESC);
--> statement-breakpoint
CREATE INDEX program_numbers_org_waiting_idx ON public.program_numbers (org_id) WHERE state = 'waiting';
--> statement-breakpoint
CREATE INDEX program_numbers_typed_by_idx ON public.program_numbers (typed_by) WHERE typed_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX program_numbers_confirmed_by_idx ON public.program_numbers (confirmed_by) WHERE confirmed_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.program_numbers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.program_numbers FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.program_numbers TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.program_numbers TO service_role;
