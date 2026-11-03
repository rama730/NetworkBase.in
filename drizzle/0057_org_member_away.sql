-- Report §33.5 and §33.7 (DB7, Away): an admin marks a member away for some dates, with an optional reason. Their own
-- work due in that time is excused, and work published then starts excused. Read and written through the server only.
CREATE TABLE public.org_member_away (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    reason text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_member_away_dates_check CHECK (ends_at > starts_at),
    CONSTRAINT org_member_away_reason_check CHECK (reason IS NULL OR char_length(reason) <= 300)
);
--> statement-breakpoint
CREATE INDEX org_member_away_member_idx ON public.org_member_away USING btree (org_id, user_id, ends_at);
--> statement-breakpoint
ALTER TABLE public.org_member_away ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.org_member_away FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_member_away TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.org_member_away TO service_role;
