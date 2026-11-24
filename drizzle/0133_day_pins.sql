-- Plan B1.7a (report 30.4 call 3): Pin for today — up to 3 of your own tasks or copies, private, for one day (the day in
-- your own time zone). The only new stored data for the Week view; yesterday's pins simply stop counting.

CREATE TABLE public.day_pins (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    day date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, day, task_id)
);
--> statement-breakpoint
ALTER TABLE public.day_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.day_pins FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.day_pins TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.day_pins TO service_role;
