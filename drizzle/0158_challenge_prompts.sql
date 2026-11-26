-- Plan B5.4c (report 34.5 call 2, 10): a challenge's prompts, each with an Opens on time. A prompt's title and text stay
-- here, off the challenge task, so nothing reads them before they open; people who joined hear once a day when one opens.
-- Server only.

CREATE TABLE public.challenge_prompts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    master_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    position integer NOT NULL,
    title text NOT NULL,
    body text,
    opens_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT challenge_prompts_title CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT challenge_prompts_body CHECK (body IS NULL OR char_length(body) <= 2000),
    CONSTRAINT challenge_prompts_position CHECK (position BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX challenge_prompts_master_position_idx ON public.challenge_prompts (master_id, position);
--> statement-breakpoint
CREATE INDEX challenge_prompts_opens_idx ON public.challenge_prompts (opens_at);
--> statement-breakpoint
CREATE INDEX challenge_prompts_workspace_idx ON public.challenge_prompts (workspace_id);
--> statement-breakpoint
ALTER TABLE public.challenge_prompts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.challenge_prompts FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.challenge_prompts TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.challenge_prompts TO service_role;
