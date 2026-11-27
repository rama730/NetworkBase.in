-- Plan B7.2a (report 36.3 calls 1–3, 8): a club's positions are labels with a Season term, separate from permission roles;
-- holding one gives the role it names. Each term row is one person in one position for one Season, kept after they leave
-- (the committee history). An appointment waits for the holder's yes. Server only.

CREATE TABLE public.club_position_terms (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    position_id text NOT NULL,
    position_label text NOT NULL,
    season text NOT NULL,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    holder_name text NOT NULL,
    how text NOT NULL,
    state text DEFAULT 'offered' NOT NULL,
    offered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- True when taking this position made them a Coordinator: only that is taken back when the term ends.
    gave_role boolean DEFAULT false NOT NULL,
    accepted_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT club_position_terms_position CHECK (position_id ~ '^[a-z0-9-]{1,30}$'),
    CONSTRAINT club_position_terms_label CHECK (char_length(position_label) BETWEEN 1 AND 60),
    CONSTRAINT club_position_terms_season CHECK (char_length(season) BETWEEN 1 AND 20),
    CONSTRAINT club_position_terms_name CHECK (char_length(holder_name) BETWEEN 1 AND 120),
    CONSTRAINT club_position_terms_how CHECK (how IN ('appointment', 'election')),
    CONSTRAINT club_position_terms_state CHECK (state IN ('offered', 'holding', 'declined', 'ended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX club_position_terms_one_holder ON public.club_position_terms (org_id, position_id, season) WHERE state IN ('offered', 'holding');
--> statement-breakpoint
CREATE INDEX club_position_terms_org_idx ON public.club_position_terms (org_id, season);
--> statement-breakpoint
CREATE INDEX club_position_terms_user_idx ON public.club_position_terms (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_position_terms_offered_by_idx ON public.club_position_terms (offered_by) WHERE offered_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.club_position_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_position_terms FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_position_terms TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_position_terms TO service_role;
