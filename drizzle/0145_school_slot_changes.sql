-- Plan B3.4d (report 32.5 S4 layer 3, "Today only"): a one-off change to a timetable slot on one day — the lesson is
-- cancelled (no cover needed) or moves room. Server only.

CREATE TABLE public.school_slot_changes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    slot_id uuid NOT NULL REFERENCES public.school_timetable_slots(id) ON DELETE CASCADE,
    day date NOT NULL,
    kind text NOT NULL,
    room text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_slot_changes_one_per_day UNIQUE (slot_id, day),
    CONSTRAINT school_slot_changes_kind CHECK (kind IN ('cancelled', 'room')),
    CONSTRAINT school_slot_changes_room CHECK ((kind = 'room' AND room IS NOT NULL AND char_length(room) BETWEEN 1 AND 40) OR (kind = 'cancelled' AND room IS NULL))
);
--> statement-breakpoint
CREATE INDEX school_slot_changes_workspace_day_idx ON public.school_slot_changes (workspace_id, day);
--> statement-breakpoint
ALTER TABLE public.school_slot_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.school_slot_changes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_slot_changes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.school_slot_changes TO service_role;
