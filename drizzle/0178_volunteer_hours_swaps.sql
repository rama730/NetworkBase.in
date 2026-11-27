-- Plan B8.1b (report 37.3 calls 4–6): hours a volunteer adds by hand, which count only once a coordinator confirms them,
-- and swaps — a volunteer asks a named volunteer to take their place on a shift, who must say yes. Server only.

CREATE TABLE public.volunteer_hours (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    day date NOT NULL,
    hours numeric(5,2) NOT NULL,
    role_id text,
    note text NOT NULL DEFAULT '',
    state text DEFAULT 'waiting' NOT NULL,
    confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT volunteer_hours_state CHECK (state IN ('waiting', 'confirmed', 'declined')),
    CONSTRAINT volunteer_hours_amount CHECK (hours > 0 AND hours <= 24),
    CONSTRAINT volunteer_hours_note CHECK (char_length(note) <= 500 AND char_length(coalesce(role_id, '')) <= 30)
);
--> statement-breakpoint
CREATE INDEX volunteer_hours_org_user_idx ON public.volunteer_hours (org_id, user_id, day);
--> statement-breakpoint
CREATE INDEX volunteer_hours_user_idx ON public.volunteer_hours (user_id);
--> statement-breakpoint
CREATE INDEX volunteer_hours_waiting_idx ON public.volunteer_hours (org_id) WHERE state = 'waiting';
--> statement-breakpoint
CREATE INDEX volunteer_hours_confirmed_by_idx ON public.volunteer_hours (confirmed_by) WHERE confirmed_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.volunteer_swaps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    shift_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    from_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text DEFAULT 'asked' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    CONSTRAINT volunteer_swaps_state CHECK (state IN ('asked', 'accepted', 'declined', 'withdrawn')),
    CONSTRAINT volunteer_swaps_people CHECK (from_user <> to_user)
);
--> statement-breakpoint
CREATE UNIQUE INDEX volunteer_swaps_one_open ON public.volunteer_swaps (shift_id, from_user) WHERE state = 'asked';
--> statement-breakpoint
CREATE INDEX volunteer_swaps_org_idx ON public.volunteer_swaps (org_id);
--> statement-breakpoint
CREATE INDEX volunteer_swaps_from_idx ON public.volunteer_swaps (from_user);
--> statement-breakpoint
CREATE INDEX volunteer_swaps_to_idx ON public.volunteer_swaps (to_user);
--> statement-breakpoint
ALTER TABLE public.volunteer_hours ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.volunteer_swaps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.volunteer_hours FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.volunteer_swaps FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.volunteer_hours TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.volunteer_swaps TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.volunteer_hours TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.volunteer_swaps TO service_role;
