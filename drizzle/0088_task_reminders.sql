-- Report C2 (M4b): `nb task remind 4 "tomorrow 9am"`. The chat due job (chat/due.wake) fires them, so reminders add
-- no Inngest function and no scheduled runs; a claim lease keeps two runs from sending one twice.
CREATE TABLE public.task_reminders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    remind_at timestamp with time zone NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    CONSTRAINT task_reminders_note_length CHECK (note IS NULL OR char_length(note) <= 300)
);
--> statement-breakpoint
CREATE INDEX task_reminders_due_idx ON public.task_reminders (remind_at) WHERE sent_at IS NULL;
--> statement-breakpoint
CREATE INDEX task_reminders_task_user_idx ON public.task_reminders (task_id, user_id);
--> statement-breakpoint
CREATE INDEX task_reminders_user_idx ON public.task_reminders (user_id);
--> statement-breakpoint
ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.task_reminders FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_reminders TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.task_reminders TO service_role;
