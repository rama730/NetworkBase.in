-- Report F4 (M6): editors that signed in with OAuth renew by themselves instead of signing in again every 30 days.
-- A refresh token works once; each use issues the next one in its family. Using an old one again means it was
-- copied, so the whole family and its sign-in are revoked. Revoking the sign-in stops the family too.
CREATE TABLE IF NOT EXISTS public.oauth_refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.extension_device_sessions(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    family_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_idx ON public.oauth_refresh_tokens (family_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_session_idx ON public.oauth_refresh_tokens (session_id);
--> statement-breakpoint
ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.oauth_refresh_tokens FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_refresh_tokens TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.oauth_refresh_tokens TO service_role;
