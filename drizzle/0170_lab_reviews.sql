-- Plan B6.5c (report 35.6 calls 5–8): a research lab's annual review (the person's Progress report → supervisor feedback
-- → committee comments → Agreed next steps; no ratings, scores or rankings), the development plan (up to 3 goals a year,
-- career aims, About me; private to the person and their supervisors), and concerns (private to whoever receives them,
-- never sent to the person they're about). Server only.

CREATE TABLE public.lab_reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    milestone_key text NOT NULL,
    state text DEFAULT 'writing' NOT NULL,
    report jsonb DEFAULT '{}'::jsonb NOT NULL,
    feedback text DEFAULT '' NOT NULL,
    committee_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    committee_comments jsonb DEFAULT '[]'::jsonb NOT NULL,
    next_steps text DEFAULT '' NOT NULL,
    handed_in_at timestamp with time zone,
    agreed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_reviews_one_per_milestone UNIQUE (org_id, user_id, milestone_key),
    CONSTRAINT lab_reviews_state CHECK (state IN ('writing', 'with_supervisor', 'with_committee', 'agreed')),
    CONSTRAINT lab_reviews_feedback CHECK (char_length(feedback) <= 10000 AND char_length(next_steps) <= 4000),
    CONSTRAINT lab_reviews_committee CHECK (cardinality(committee_ids) <= 5)
);
--> statement-breakpoint
CREATE INDEX lab_reviews_user_idx ON public.lab_reviews (user_id);
--> statement-breakpoint
CREATE INDEX lab_reviews_open_idx ON public.lab_reviews (org_id, state) WHERE state <> 'agreed';
--> statement-breakpoint
CREATE TABLE public.lab_plans (
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    year integer NOT NULL,
    goals jsonb DEFAULT '[]'::jsonb NOT NULL,
    career_aims text DEFAULT '' NOT NULL,
    about_me text DEFAULT '' NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (org_id, user_id, year),
    CONSTRAINT lab_plans_year CHECK (year BETWEEN 2000 AND 2100),
    CONSTRAINT lab_plans_lengths CHECK (char_length(career_aims) <= 2000 AND char_length(about_me) <= 4000)
);
--> statement-breakpoint
CREATE INDEX lab_plans_user_idx ON public.lab_plans (user_id);
--> statement-breakpoint
CREATE TABLE public.lab_concerns (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    from_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    to_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    about_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_concerns_body CHECK (char_length(body) BETWEEN 1 AND 4000),
    CONSTRAINT lab_concerns_not_about_receiver CHECK (about_id IS NULL OR about_id <> to_id)
);
--> statement-breakpoint
CREATE INDEX lab_concerns_to_idx ON public.lab_concerns (to_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX lab_concerns_from_idx ON public.lab_concerns (from_id) WHERE from_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_concerns_about_idx ON public.lab_concerns (about_id) WHERE about_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_concerns_org_idx ON public.lab_concerns (org_id);
--> statement-breakpoint
ALTER TABLE public.lab_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_concerns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_reviews FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_plans FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_concerns FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_reviews TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_plans TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lab_concerns TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_reviews TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_plans TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_concerns TO service_role;
