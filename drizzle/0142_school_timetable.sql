-- Plan B3.4a (report 32.5 S4 calls 1–4): a school's timetable. NB doesn't build timetables: slots (day × period, an
-- optional Week A / B) are imported from a CSV or typed, each naming a class (6A), its course, the teacher and room.
-- The school's day patterns live in its settings. Server only; no student data.

CREATE TABLE public.school_timetable_slots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    day smallint NOT NULL,
    period text NOT NULL,
    week text,
    class_name text NOT NULL,
    course_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
    teacher_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    room text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT school_timetable_slots_day CHECK (day BETWEEN 1 AND 7),
    CONSTRAINT school_timetable_slots_period_length CHECK (char_length(period) BETWEEN 1 AND 20),
    CONSTRAINT school_timetable_slots_week CHECK (week IS NULL OR week IN ('A', 'B')),
    CONSTRAINT school_timetable_slots_class_length CHECK (char_length(class_name) BETWEEN 1 AND 40),
    CONSTRAINT school_timetable_slots_room_length CHECK (room IS NULL OR char_length(room) <= 40)
);
--> statement-breakpoint
CREATE INDEX school_timetable_slots_workspace_day_idx ON public.school_timetable_slots (workspace_id, day);
--> statement-breakpoint
CREATE INDEX school_timetable_slots_teacher_idx ON public.school_timetable_slots (teacher_id);
--> statement-breakpoint
ALTER TABLE public.school_timetable_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.school_timetable_slots FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_timetable_slots TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.school_timetable_slots TO service_role;
