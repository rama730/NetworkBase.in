-- Plan B5.3 (report 34.4, M3): community events take only the RSVP slice of the parked Event planner (call 1).
-- The event itself is S1's `event` item (tasks.item_type = 'event'); what must never reach a task list, the CLI or the
-- API sits here: the online link (shown only to people Going, call 4) and the place limit. RSVPs need membership
-- (call 2); the waitlist is first come and moves up on its own (call 3); private RSVPs are counted, never named.
-- Server only.

CREATE TABLE public.community_events (
    task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    online_link text,
    place_limit integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_events_link CHECK (online_link IS NULL OR (char_length(online_link) <= 500 AND online_link ~ '^https://')),
    CONSTRAINT community_events_limit CHECK (place_limit IS NULL OR place_limit BETWEEN 1 AND 100000)
);
--> statement-breakpoint
CREATE INDEX community_events_workspace_idx ON public.community_events (workspace_id);
--> statement-breakpoint
CREATE TABLE public.community_rsvps (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    state text NOT NULL,
    private boolean DEFAULT false NOT NULL,
    checked_in_at timestamp with time zone,
    responded_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (task_id, user_id),
    CONSTRAINT community_rsvps_state CHECK (state IN ('going', 'waitlisted', 'cant_go'))
);
--> statement-breakpoint
CREATE INDEX community_rsvps_waitlist_idx ON public.community_rsvps (task_id, state, responded_at);
--> statement-breakpoint
CREATE INDEX community_rsvps_user_idx ON public.community_rsvps (user_id);
--> statement-breakpoint
CREATE INDEX community_rsvps_workspace_idx ON public.community_rsvps (workspace_id);
--> statement-breakpoint
ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.community_rsvps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.community_events FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.community_rsvps FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_events TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_rsvps TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.community_events TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.community_rsvps TO service_role;
