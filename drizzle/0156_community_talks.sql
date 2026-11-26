-- Plan B5.3d (report 34.4 call 5, M3): Call for talks. Members propose a talk for an event (title, a line, minutes);
-- the event's hosts Accept it into a run-of-show slot or say Not this time, with a kind default line. Server only.

CREATE TABLE public.community_talks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text NOT NULL,
    line text,
    minutes integer NOT NULL,
    state text DEFAULT 'proposed' NOT NULL,
    slot text,
    decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_talks_state CHECK (state IN ('proposed', 'accepted', 'declined')),
    CONSTRAINT community_talks_title CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT community_talks_line CHECK (line IS NULL OR char_length(line) <= 300),
    CONSTRAINT community_talks_minutes CHECK (minutes BETWEEN 1 AND 120),
    CONSTRAINT community_talks_slot CHECK (slot IS NULL OR slot ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE INDEX community_talks_event_idx ON public.community_talks (task_id, state);
--> statement-breakpoint
CREATE INDEX community_talks_user_idx ON public.community_talks (user_id);
--> statement-breakpoint
CREATE INDEX community_talks_workspace_idx ON public.community_talks (workspace_id);
--> statement-breakpoint
CREATE INDEX community_talks_decided_by_idx ON public.community_talks (decided_by) WHERE decided_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.community_talks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.community_talks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_talks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.community_talks TO service_role;
