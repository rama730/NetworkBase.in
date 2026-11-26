-- Plan B6.1c (report 35.2 call 5): a lab membership can end as Finished; the person is then asked "List me as alumni?"
-- and writes Now at. Nothing shows without their yes. One row per person per lab, kept when they come back. Server only.

ALTER TABLE public.profile_contributions DROP CONSTRAINT profile_contributions_end_reason_check;
--> statement-breakpoint
ALTER TABLE public.profile_contributions ADD CONSTRAINT profile_contributions_end_reason_check CHECK (((end_reason IS NULL) OR (end_reason = ANY (ARRAY['left'::text, 'removed'::text, 'term_ended'::text, 'org_deleted'::text, 'completed'::text, 'workspace_completed'::text, 'finished'::text]))));
--> statement-breakpoint
CREATE TABLE public.lab_alumni (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    position_label text,
    start_year integer,
    end_year integer NOT NULL,
    listed boolean DEFAULT false NOT NULL,
    now_at text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT lab_alumni_position CHECK (position_label IS NULL OR char_length(position_label) <= 40),
    CONSTRAINT lab_alumni_now_at CHECK (now_at IS NULL OR char_length(now_at) <= 120),
    CONSTRAINT lab_alumni_years CHECK (end_year BETWEEN 1950 AND 2100 AND (start_year IS NULL OR start_year BETWEEN 1950 AND 2100))
);
--> statement-breakpoint
CREATE INDEX lab_alumni_user_idx ON public.lab_alumni (user_id);
--> statement-breakpoint
ALTER TABLE public.lab_alumni ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_alumni FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_alumni TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_alumni TO service_role;
