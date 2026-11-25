-- Plan B3.4c (report 32.5 S4 calls 3, 9): duties — a place × day × time (a period, or Before / After school) × person,
-- repeating with the rotation — and swaps: the person asks a colleague, the colleague's yes makes it so (no manager
-- approval; the school's leaders are told). Server only.

CREATE TABLE public.school_duties (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    place text NOT NULL,
    day smallint NOT NULL,
    slot text NOT NULL,
    week text,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_duties_day CHECK (day BETWEEN 1 AND 7),
    CONSTRAINT school_duties_place_length CHECK (char_length(place) BETWEEN 1 AND 60),
    CONSTRAINT school_duties_slot_length CHECK (char_length(slot) BETWEEN 1 AND 30),
    CONSTRAINT school_duties_week CHECK (week IS NULL OR week IN ('A', 'B'))
);
--> statement-breakpoint
CREATE INDEX school_duties_workspace_day_idx ON public.school_duties (workspace_id, day);
--> statement-breakpoint
CREATE TABLE public.school_duty_swaps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    duty_id uuid NOT NULL REFERENCES public.school_duties(id) ON DELETE CASCADE,
    day date NOT NULL,
    from_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text DEFAULT 'asked' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT school_duty_swaps_state CHECK (state IN ('asked', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE INDEX school_duty_swaps_workspace_idx ON public.school_duty_swaps (workspace_id, day);
--> statement-breakpoint
CREATE UNIQUE INDEX school_duty_swaps_one_accepted ON public.school_duty_swaps (duty_id, day) WHERE state = 'accepted';
--> statement-breakpoint
ALTER TABLE public.school_duties ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.school_duty_swaps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.school_duties, public.school_duty_swaps FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_duties, public.school_duty_swaps TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.school_duties, public.school_duty_swaps TO service_role;
