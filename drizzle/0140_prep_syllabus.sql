-- Plan B2.4b (report 31.4 C3 calls 8–9): the class's syllabus topics (staff), each learner's own stage per topic
-- (staff see counts), and a learner's private mistakes with a fixed reason, shared with their mentor only when they
-- choose. Server only.

CREATE TABLE public.prep_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    position integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prep_topics_name_length CHECK (char_length(name) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX prep_topics_workspace_idx ON public.prep_topics (workspace_id, position);
--> statement-breakpoint
CREATE TABLE public.prep_topic_stages (
    topic_id uuid NOT NULL REFERENCES public.prep_topics(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stage text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (topic_id, user_id),
    CONSTRAINT prep_topic_stages_stage_check CHECK (stage IN ('not_started', 'learning', 'revised', 'confident'))
);
--> statement-breakpoint
CREATE TABLE public.prep_mistakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    topic_id uuid REFERENCES public.prep_topics(id) ON DELETE SET NULL,
    reason text NOT NULL,
    note text,
    shared_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prep_mistakes_reason_check CHECK (reason IN ('careless', 'concept', 'time', 'misread', 'unsure')),
    CONSTRAINT prep_mistakes_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
--> statement-breakpoint
CREATE INDEX prep_mistakes_learner_idx ON public.prep_mistakes (workspace_id, user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE public.prep_topics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.prep_topic_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.prep_mistakes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.prep_topics, public.prep_topic_stages, public.prep_mistakes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prep_topics, public.prep_topic_stages, public.prep_mistakes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.prep_topics, public.prep_topic_stages, public.prep_mistakes TO service_role;
