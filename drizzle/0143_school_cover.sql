-- Plan B3.4b (report 32.5 S4 calls 5–7): absences by day or period (the reason is seen only by the school's leaders)
-- and cover — a timetable slot on one day given to a colleague, with a cover note. Server only; no student data.

CREATE TABLE public.school_absences (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    day date NOT NULL,
    from_period text,
    to_period text,
    reason text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_absences_reason_length CHECK (reason IS NULL OR char_length(reason) <= 300),
    CONSTRAINT school_absences_period_length CHECK ((from_period IS NULL OR char_length(from_period) <= 20) AND (to_period IS NULL OR char_length(to_period) <= 20))
);
--> statement-breakpoint
CREATE INDEX school_absences_workspace_day_idx ON public.school_absences (workspace_id, day);
--> statement-breakpoint
CREATE TABLE public.school_covers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL REFERENCES public.school_timetable_slots(id) ON DELETE CASCADE,
    day date NOT NULL,
    cover_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    note text,
    assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_covers_one_per_slot UNIQUE (slot_id, day),
    CONSTRAINT school_covers_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
--> statement-breakpoint
CREATE INDEX school_covers_workspace_day_idx ON public.school_covers (workspace_id, day);
--> statement-breakpoint
CREATE INDEX school_covers_cover_user_idx ON public.school_covers (cover_user_id);
--> statement-breakpoint
ALTER TABLE public.school_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.school_covers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.school_absences, public.school_covers FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_absences, public.school_covers TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.school_absences, public.school_covers TO service_role;
