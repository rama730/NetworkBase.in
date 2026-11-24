-- Plan B1.4a (report 30.7 W6): attendance — one record per class session per student: Present, Late, Absent or
-- Excused, with an optional note and who marked it. Personal data: server only (no browser grants); it goes with
-- the account (ON DELETE CASCADE) and into the account export.

CREATE TABLE public.attendance_records (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    session_key text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status text NOT NULL,
    note text,
    marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    PRIMARY KEY (workspace_id, session_key, user_id),
    CONSTRAINT attendance_records_status_check CHECK (status IN ('present', 'late', 'absent', 'excused')),
    CONSTRAINT attendance_records_session_check CHECK (session_key ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
    CONSTRAINT attendance_records_note_length CHECK (note IS NULL OR char_length(note) <= 300)
);
--> statement-breakpoint
CREATE INDEX attendance_records_user_idx ON public.attendance_records (user_id, workspace_id);
--> statement-breakpoint
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.attendance_records FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_records TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.attendance_records TO service_role;
