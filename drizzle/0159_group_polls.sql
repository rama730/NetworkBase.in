-- Plan B5.5c (report 34.6 call 10): one Poll item — a question with up to five times or options, ticks by the group's
-- members, closing at a time; results are counts, and a host confirms the pick. Server only.

CREATE TABLE public.group_polls (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    question text NOT NULL,
    kind text NOT NULL,
    options jsonb NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    picked integer,
    picked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_polls_kind CHECK (kind IN ('times', 'options')),
    CONSTRAINT group_polls_question CHECK (char_length(question) BETWEEN 1 AND 200),
    CONSTRAINT group_polls_options CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 5),
    CONSTRAINT group_polls_picked CHECK (picked IS NULL OR picked BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE INDEX group_polls_workspace_idx ON public.group_polls (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX group_polls_created_by_idx ON public.group_polls (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX group_polls_picked_by_idx ON public.group_polls (picked_by) WHERE picked_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.group_poll_votes (
    poll_id uuid NOT NULL REFERENCES public.group_polls(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    option integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (poll_id, user_id, option),
    CONSTRAINT group_poll_votes_option CHECK (option BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE INDEX group_poll_votes_user_idx ON public.group_poll_votes (user_id);
--> statement-breakpoint
ALTER TABLE public.group_polls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.group_poll_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.group_polls FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.group_poll_votes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_polls TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_poll_votes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.group_polls TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.group_poll_votes TO service_role;
