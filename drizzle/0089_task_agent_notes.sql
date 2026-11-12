-- Report D16 (M4c): an agent saves where it stopped on a task ("parsed 3 of 5 files; next: tests"), so the next session
-- continues from there on any computer. The person reads or deletes them on the task under "Agent notes".
CREATE TABLE public.task_agent_notes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id text,
    agent_name text,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_agent_notes_note_length CHECK (char_length(note) BETWEEN 1 AND 2000),
    CONSTRAINT task_agent_notes_agent_name_length CHECK (agent_name IS NULL OR char_length(agent_name) <= 80)
);
--> statement-breakpoint
CREATE INDEX task_agent_notes_task_created_idx ON public.task_agent_notes (task_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX task_agent_notes_user_idx ON public.task_agent_notes (user_id);
--> statement-breakpoint
ALTER TABLE public.task_agent_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.task_agent_notes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_agent_notes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.task_agent_notes TO service_role;
