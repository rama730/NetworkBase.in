-- Workflow tabs A5.1 (report 38.12 D3): quarterly goals. A key result (a task of type key_result) is checked in with a
-- value and a confidence; the newest check-in is its current value. Server only (no browser grants), like the other
-- workflow tables.

CREATE TABLE public.key_result_check_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    value numeric NOT NULL,
    confidence smallint NOT NULL,
    note text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT key_result_check_ins_confidence_check CHECK (confidence BETWEEN 1 AND 10),
    CONSTRAINT key_result_check_ins_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
--> statement-breakpoint
CREATE INDEX key_result_check_ins_task_idx ON public.key_result_check_ins (task_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE public.key_result_check_ins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.key_result_check_ins FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.key_result_check_ins TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.key_result_check_ins TO service_role;
