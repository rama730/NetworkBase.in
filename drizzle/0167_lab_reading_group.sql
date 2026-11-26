-- Plan B6.4b (report 35.4 calls 6–7): a research lab's reading group. Sessions come from the lab's weekly slot with a
-- presenter in rotation (skipping anyone Away that day); the presenter picks a source by a set time; members get one
-- Read before notice; a swap needs the other person's yes. Sources can be suggested for the group. Server only.

CREATE TABLE public.lab_reading_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    starts_at timestamp with time zone NOT NULL,
    presenter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    source_id uuid REFERENCES public.literature_sources(id) ON DELETE SET NULL,
    notes text DEFAULT '' NOT NULL,
    done_at timestamp with time zone,
    next_notice_at timestamp with time zone,
    pick_notice_at timestamp with time zone,
    late_notice_at timestamp with time zone,
    read_before_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_reading_sessions_one_per_slot UNIQUE (org_id, starts_at),
    CONSTRAINT lab_reading_sessions_notes CHECK (char_length(notes) <= 20000)
);
--> statement-breakpoint
CREATE INDEX lab_reading_sessions_presenter_idx ON public.lab_reading_sessions (presenter_id) WHERE presenter_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_reading_sessions_source_idx ON public.lab_reading_sessions (source_id) WHERE source_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_reading_sessions_open_idx ON public.lab_reading_sessions (starts_at) WHERE done_at IS NULL;
--> statement-breakpoint
CREATE TABLE public.lab_reading_swaps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES public.lab_reading_sessions(id) ON DELETE CASCADE,
    from_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text DEFAULT 'asked' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    CONSTRAINT lab_reading_swaps_state CHECK (state IN ('asked', 'accepted', 'declined', 'withdrawn')),
    CONSTRAINT lab_reading_swaps_people CHECK (from_id <> to_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX lab_reading_swaps_one_open ON public.lab_reading_swaps (session_id) WHERE state = 'asked';
--> statement-breakpoint
CREATE INDEX lab_reading_swaps_from_idx ON public.lab_reading_swaps (from_id);
--> statement-breakpoint
CREATE INDEX lab_reading_swaps_to_idx ON public.lab_reading_swaps (to_id);
--> statement-breakpoint
ALTER TABLE public.literature_sources
    ADD COLUMN suggested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN suggested_at timestamp with time zone;
--> statement-breakpoint
CREATE INDEX literature_sources_suggested_by_idx ON public.literature_sources (suggested_by) WHERE suggested_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_reading_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_reading_swaps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_reading_sessions FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_reading_swaps FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_reading_sessions TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lab_reading_swaps TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_reading_sessions TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_reading_swaps TO service_role;
