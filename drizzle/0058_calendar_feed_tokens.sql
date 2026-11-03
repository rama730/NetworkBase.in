-- Report §33.5 and §41.2 ("Later": Calendar): a private calendar link for Google or Apple. One random token per
-- person; the feed shows only their own due work and the sprints of the organizations and workspaces they're in.
CREATE TABLE public.calendar_feed_tokens (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_feed_tokens_token_key UNIQUE (token),
    CONSTRAINT calendar_feed_tokens_token_check CHECK (char_length(token) >= 32)
);
--> statement-breakpoint
ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.calendar_feed_tokens FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.calendar_feed_tokens TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.calendar_feed_tokens TO service_role;
