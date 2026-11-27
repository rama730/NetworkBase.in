-- Plan B8.3b (report 37.5 calls 8–9): a program's stories. Each person named or shown needs their yes recorded — a
-- member gives it themselves; for someone outside, the owner records who gave it and when (given offline). A story is
-- published only when every named person has consented, and withdrawing consent unpublishes it at once. Server only.

CREATE TABLE public.program_stories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    program_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    headline text NOT NULL,
    body text NOT NULL DEFAULT '',
    people jsonb DEFAULT '[]'::jsonb NOT NULL,
    state text DEFAULT 'draft' NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT program_stories_state CHECK (state IN ('draft', 'published')),
    CONSTRAINT program_stories_text CHECK (char_length(headline) BETWEEN 1 AND 140 AND char_length(body) <= 4000),
    CONSTRAINT program_stories_people CHECK (jsonb_typeof(people) = 'array' AND jsonb_array_length(people) <= 20)
);
--> statement-breakpoint
CREATE INDEX program_stories_program_idx ON public.program_stories (program_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX program_stories_org_idx ON public.program_stories (org_id) WHERE state = 'published';
--> statement-breakpoint
CREATE INDEX program_stories_created_by_idx ON public.program_stories (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.program_stories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.program_stories FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.program_stories TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.program_stories TO service_role;
