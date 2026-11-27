-- Plan B7.2b (report 36.3 calls 4–7): a club's elections. Nominations (the nominee accepts), statements, a secret ballot
-- and results with a run-off on a tie, run by a returning officer who isn't standing. A ballot row holds a choice and no
-- voter; a separate row holds only that the person voted — the two are never joined (no shared id, no timestamps on
-- ballots). One vote per member per position per round is the voted table's key. Server only.

CREATE TABLE public.club_elections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    season text NOT NULL,
    phase text DEFAULT 'nominations' NOT NULL,
    returning_officer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    show_counts boolean DEFAULT false NOT NULL,
    rounds jsonb DEFAULT '{}'::jsonb NOT NULL,
    results jsonb,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT club_elections_phase CHECK (phase IN ('nominations', 'voting', 'results')),
    CONSTRAINT club_elections_season CHECK (char_length(season) BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX club_elections_one_open ON public.club_elections (org_id) WHERE phase <> 'results';
--> statement-breakpoint
CREATE INDEX club_elections_org_idx ON public.club_elections (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX club_elections_ro_idx ON public.club_elections (returning_officer_id) WHERE returning_officer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_elections_created_by_idx ON public.club_elections (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.club_candidates (
    election_id uuid NOT NULL REFERENCES public.club_elections(id) ON DELETE CASCADE,
    position_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text DEFAULT 'nominated' NOT NULL,
    statement text DEFAULT '' NOT NULL,
    nominated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (election_id, position_id, user_id),
    CONSTRAINT club_candidates_state CHECK (state IN ('nominated', 'standing', 'declined', 'withdrawn')),
    CONSTRAINT club_candidates_statement CHECK (char_length(statement) <= 2000)
);
--> statement-breakpoint
CREATE INDEX club_candidates_user_idx ON public.club_candidates (user_id);
--> statement-breakpoint
CREATE INDEX club_candidates_nominated_by_idx ON public.club_candidates (nominated_by) WHERE nominated_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.club_ballots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    election_id uuid NOT NULL REFERENCES public.club_elections(id) ON DELETE CASCADE,
    position_id text NOT NULL,
    round integer DEFAULT 1 NOT NULL,
    -- NULL is Abstain. No voter column, ever.
    choice_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX club_ballots_count_idx ON public.club_ballots (election_id, position_id, round);
--> statement-breakpoint
CREATE INDEX club_ballots_choice_idx ON public.club_ballots (choice_id) WHERE choice_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.club_voted (
    election_id uuid NOT NULL REFERENCES public.club_elections(id) ON DELETE CASCADE,
    position_id text NOT NULL,
    round integer NOT NULL,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (election_id, position_id, round, user_id)
);
--> statement-breakpoint
CREATE INDEX club_voted_user_idx ON public.club_voted (user_id);
--> statement-breakpoint
ALTER TABLE public.club_elections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.club_candidates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.club_ballots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.club_voted ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_elections FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_candidates FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_ballots FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_voted FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_elections TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_candidates TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.club_ballots TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.club_voted TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_elections TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_candidates TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_ballots TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_voted TO service_role;
