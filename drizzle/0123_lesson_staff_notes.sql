-- Plan B1.2 (report 30.3 W2, layer 16): a lesson's teacher notes are for Teachers and TAs only, so they live in their own
-- server-only table and never in tasks.type_fields, which every task read can return. Server only (no browser grants).

CREATE TABLE public.lesson_staff_notes (
    task_id uuid NOT NULL PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    notes text NOT NULL,
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lesson_staff_notes_length CHECK (char_length(notes) <= 20000)
);
--> statement-breakpoint
CREATE INDEX lesson_staff_notes_workspace_idx ON public.lesson_staff_notes (workspace_id);
--> statement-breakpoint
ALTER TABLE public.lesson_staff_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lesson_staff_notes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lesson_staff_notes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lesson_staff_notes TO service_role;
