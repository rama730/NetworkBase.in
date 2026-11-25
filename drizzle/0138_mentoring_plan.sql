-- Plan B2.3b (report 31.5 C5): the rest of mentoring. Objectives (up to 3 open, kept to the pair), a mentor's weekly
-- time slots and booked check-ins (a time on the dated entry), concerns (a private, logged note to the instructor),
-- and the mentor's note on the learner's completion entry (shown only after the learner approves). Server only.

ALTER TABLE public.mentor_checkins ADD COLUMN starts_at timestamp with time zone;
--> statement-breakpoint
CREATE TABLE public.mentor_objectives (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    status text DEFAULT 'on_track' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mentor_objectives_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
    CONSTRAINT mentor_objectives_status_check CHECK (status IN ('on_track', 'at_risk', 'done'))
);
--> statement-breakpoint
CREATE INDEX mentor_objectives_learner_idx ON public.mentor_objectives (workspace_id, learner_id);
--> statement-breakpoint
CREATE TABLE public.mentor_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    mentor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    weekday integer NOT NULL,
    start_time text NOT NULL,
    CONSTRAINT mentor_slots_weekday_check CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT mentor_slots_time_check CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT mentor_slots_one UNIQUE (workspace_id, mentor_id, weekday, start_time)
);
--> statement-breakpoint
CREATE TABLE public.mentor_concerns (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    from_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    about_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mentor_concerns_body_length CHECK (char_length(body) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX mentor_concerns_workspace_idx ON public.mentor_concerns (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE public.mentor_notes (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    learner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mentor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    body text NOT NULL,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, learner_id),
    CONSTRAINT mentor_notes_body_length CHECK (char_length(body) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE public.mentor_objectives ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mentor_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mentor_concerns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mentor_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.mentor_objectives, public.mentor_slots, public.mentor_concerns, public.mentor_notes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mentor_objectives, public.mentor_slots, public.mentor_concerns, public.mentor_notes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.mentor_objectives, public.mentor_slots, public.mentor_concerns, public.mentor_notes TO service_role;
