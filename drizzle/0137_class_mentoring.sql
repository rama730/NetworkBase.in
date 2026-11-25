-- Plan B2.3a (report 31.5 C5): mentoring in a class. A mentor group is a class section of kind 'mentor' (one per
-- learner, the W8 rule). Check-ins are rows private to the pair (learner and the mentors of their group): Prep from
-- the learner, notes from both, shared with staff only when the learner shares an entry. Was this useful? answers
-- show only as totals from 5. Server only.

ALTER TABLE public.class_sections DROP CONSTRAINT class_sections_kind_check;
--> statement-breakpoint
ALTER TABLE public.class_sections ADD CONSTRAINT class_sections_kind_check CHECK (kind IN ('lab', 'tutorial', 'lecture', 'mentor'));
--> statement-breakpoint
CREATE TABLE public.mentor_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    on_date date NOT NULL,
    prep jsonb,
    prep_done_at timestamp with time zone,
    notes text,
    shared_at timestamp with time zone,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mentor_checkins_notes_length CHECK (notes IS NULL OR char_length(notes) <= 20000),
    CONSTRAINT mentor_checkins_one_per_day UNIQUE (workspace_id, learner_id, on_date)
);
--> statement-breakpoint
CREATE INDEX mentor_checkins_learner_idx ON public.mentor_checkins (workspace_id, learner_id, on_date DESC);
--> statement-breakpoint
CREATE TABLE public.mentor_useful (
    checkin_id uuid NOT NULL PRIMARY KEY REFERENCES public.mentor_checkins(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    mentor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    answer text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mentor_useful_answer_check CHECK (answer IN ('very', 'somewhat', 'not_really')),
    CONSTRAINT mentor_useful_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX mentor_useful_mentor_idx ON public.mentor_useful (workspace_id, mentor_id);
--> statement-breakpoint
ALTER TABLE public.mentor_checkins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mentor_useful ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.mentor_checkins FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.mentor_useful FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mentor_checkins TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mentor_useful TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.mentor_checkins TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.mentor_useful TO service_role;
