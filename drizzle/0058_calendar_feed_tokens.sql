-- Report §33.5 and §41.2 ("Later": Calendar): a private calendar link for Google or Apple. One random token per
-- person; the feed shows only their own due work and the sprints of the organizations and workspaces they're in.
-- Only the token's SHA-256 is kept, so a copy of this table opens no one's calendar; the link is shown once.
CREATE TABLE public.calendar_feed_tokens (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_feed_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT calendar_feed_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.calendar_feed_tokens FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.calendar_feed_tokens TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.calendar_feed_tokens TO service_role;
