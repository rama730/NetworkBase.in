-- Plan B7.3c (report 36.4 call 4): a club motion sent for an online vote — a secret ballot of members staying this Season
-- that closes at its time. As with elections (0172), a ballot row holds a choice and no voter; a separate row records only
-- that the person voted (its key stops a second vote). Quorum is fixed when the vote opens. Server only.

CREATE TABLE public.club_motion_votes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    doc_id uuid NOT NULL REFERENCES public.workspace_documents(id) ON DELETE CASCADE,
    motion_id text NOT NULL,
    text text NOT NULL,
    amendment jsonb,
    threshold numeric NOT NULL,
    needed integer NOT NULL,
    eligible integer NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    state text DEFAULT 'open' NOT NULL,
    result jsonb,
    reminded_at timestamp with time zone,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT club_motion_votes_state CHECK (state IN ('open', 'closed')),
    CONSTRAINT club_motion_votes_text CHECK (char_length(text) BETWEEN 1 AND 500),
    CONSTRAINT club_motion_votes_threshold CHECK (threshold > 0 AND threshold <= 1),
    CONSTRAINT club_motion_votes_needed CHECK (needed >= 1 AND eligible >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX club_motion_votes_motion ON public.club_motion_votes (doc_id, motion_id);
--> statement-breakpoint
CREATE INDEX club_motion_votes_org_idx ON public.club_motion_votes (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX club_motion_votes_open_idx ON public.club_motion_votes (closes_at) WHERE state = 'open';
--> statement-breakpoint
CREATE INDEX club_motion_votes_created_by_idx ON public.club_motion_votes (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.club_motion_ballots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    vote_id uuid NOT NULL REFERENCES public.club_motion_votes(id) ON DELETE CASCADE,
    choice text NOT NULL,
    CONSTRAINT club_motion_ballots_choice CHECK (choice IN ('for', 'against', 'abstain'))
);
--> statement-breakpoint
CREATE INDEX club_motion_ballots_vote_idx ON public.club_motion_ballots (vote_id);
--> statement-breakpoint
CREATE TABLE public.club_motion_voted (
    vote_id uuid NOT NULL REFERENCES public.club_motion_votes(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (vote_id, user_id)
);
--> statement-breakpoint
CREATE INDEX club_motion_voted_user_idx ON public.club_motion_voted (user_id);
--> statement-breakpoint
ALTER TABLE public.club_motion_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.club_motion_ballots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.club_motion_voted ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_motion_votes FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_motion_ballots FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_motion_voted FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_motion_votes TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.club_motion_ballots TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.club_motion_voted TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_motion_votes TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_motion_ballots TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_motion_voted TO service_role;
