-- Plan B7.4a (report 36.5 calls 2–3): who wants a place in a club competition and what happened. Open sign-up
-- (Interested), Tryouts (a hand-in only the person and officers read), or Picked by officers. Selected, Not this time,
-- Accepted place and Declined stay between the person and the officers; a team row links the place to its team
-- workspace with a role and whether it's a substitute. Server only.

CREATE TABLE public.club_competition_people (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    competition_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    name text NOT NULL,
    wish text,
    hand_in text,
    state text DEFAULT 'interested' NOT NULL,
    team_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
    role text,
    substitute boolean DEFAULT false NOT NULL,
    decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT club_competition_people_state CHECK (state IN ('interested', 'trying', 'selected', 'not_this_time', 'accepted', 'declined')),
    CONSTRAINT club_competition_people_lengths CHECK (char_length(name) BETWEEN 1 AND 120 AND char_length(coalesce(wish, '')) <= 60
      AND char_length(coalesce(hand_in, '')) <= 2000 AND char_length(coalesce(role, '')) <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX club_competition_people_one ON public.club_competition_people (competition_id, user_id);
--> statement-breakpoint
CREATE INDEX club_competition_people_org_idx ON public.club_competition_people (org_id);
--> statement-breakpoint
CREATE INDEX club_competition_people_user_idx ON public.club_competition_people (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_competition_people_team_idx ON public.club_competition_people (team_workspace_id) WHERE team_workspace_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX club_competition_people_decided_by_idx ON public.club_competition_people (decided_by) WHERE decided_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.club_competition_people ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.club_competition_people FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.club_competition_people TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.club_competition_people TO service_role;
