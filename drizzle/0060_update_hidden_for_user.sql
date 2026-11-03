-- Live-fix 11 (report §7.2, owner decision 3 Nov 2026): the Overview's pinned announcement has an × that hides it for
-- you only, remembered on your account across devices. One row per person and post; deleting either removes it.
CREATE TABLE public.workspace_update_hidden (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    update_id uuid NOT NULL REFERENCES public.workspace_updates(id) ON DELETE CASCADE,
    hidden_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_update_hidden_pkey PRIMARY KEY (user_id, update_id)
);
--> statement-breakpoint
CREATE INDEX workspace_update_hidden_update_idx ON public.workspace_update_hidden (update_id);
--> statement-breakpoint
ALTER TABLE public.workspace_update_hidden ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_update_hidden FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_update_hidden TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_update_hidden TO service_role;
