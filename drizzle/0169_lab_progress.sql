-- Plan B6.5b (report 35.6 calls 3–4): a research lab's supervision and milestones. Each person's progress record (start
-- date, part-time, co-supervisor, supervision rhythm); a running supervision log private to the person and their
-- supervisors; milestones made from the lab's template for the person's position, due from their start date (doubled
-- for part-time), moved only with a reason. Server only.

CREATE TABLE public.lab_progress (
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    start_date date NOT NULL,
    part_time boolean DEFAULT false NOT NULL,
    co_supervisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    supervision_weeks integer DEFAULT 2 NOT NULL,
    supervision_notice_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (org_id, user_id),
    CONSTRAINT lab_progress_weeks CHECK (supervision_weeks BETWEEN 1 AND 12),
    CONSTRAINT lab_progress_co CHECK (co_supervisor_id IS NULL OR co_supervisor_id <> user_id)
);
--> statement-breakpoint
CREATE INDEX lab_progress_user_idx ON public.lab_progress (user_id);
--> statement-breakpoint
CREATE INDEX lab_progress_co_idx ON public.lab_progress (co_supervisor_id) WHERE co_supervisor_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_supervision_notes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    met_on date NOT NULL,
    topics text DEFAULT '' NOT NULL,
    notes text DEFAULT '' NOT NULL,
    next_steps text DEFAULT '' NOT NULL,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_supervision_notes_lengths CHECK (char_length(topics) <= 2000 AND char_length(notes) <= 10000 AND char_length(next_steps) <= 2000)
);
--> statement-breakpoint
CREATE INDEX lab_supervision_notes_student_idx ON public.lab_supervision_notes (org_id, student_id, met_on DESC);
--> statement-breakpoint
CREATE INDEX lab_supervision_notes_student_fk_idx ON public.lab_supervision_notes (student_id);
--> statement-breakpoint
CREATE INDEX lab_supervision_notes_author_idx ON public.lab_supervision_notes (author_id) WHERE author_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_milestones (
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    key text NOT NULL,
    name text NOT NULL,
    due_on date NOT NULL,
    state text DEFAULT 'upcoming' NOT NULL,
    moved_reason text,
    handed_in_at timestamp with time zone,
    done_at timestamp with time zone,
    done_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    notice_30_at timestamp with time zone,
    notice_7_at timestamp with time zone,
    PRIMARY KEY (org_id, user_id, key),
    CONSTRAINT lab_milestones_state CHECK (state IN ('upcoming', 'handed_in', 'done')),
    CONSTRAINT lab_milestones_name CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT lab_milestones_key CHECK (key ~ '^[a-z0-9-]{1,40}$'),
    CONSTRAINT lab_milestones_reason CHECK (moved_reason IS NULL OR char_length(moved_reason) <= 300)
);
--> statement-breakpoint
CREATE INDEX lab_milestones_user_idx ON public.lab_milestones (user_id);
--> statement-breakpoint
CREATE INDEX lab_milestones_due_idx ON public.lab_milestones (due_on) WHERE state <> 'done';
--> statement-breakpoint
CREATE INDEX lab_milestones_done_by_idx ON public.lab_milestones (done_by) WHERE done_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_supervision_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_milestones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_progress FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_supervision_notes FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_milestones FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_progress TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_supervision_notes TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_milestones TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_progress TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_supervision_notes TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_milestones TO service_role;
