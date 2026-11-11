-- An agent asking for more access (report A5, A10): a missing permission becomes a request in the person's inbox,
-- answered Allow once (one request with the same method and path within an hour), Always (adds the permission) or
-- No (no new asks for that permission for 24 hours). At most 3 open per sign-in; each expires after 24 hours.

CREATE TABLE public.agent_access_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES public.extension_device_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    reason text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT agent_access_requests_status_check CHECK (status = ANY (ARRAY['open'::text, 'once'::text, 'always'::text, 'no'::text, 'expired'::text, 'used'::text])),
    CONSTRAINT agent_access_requests_path_length CHECK (char_length(path) <= 500),
    CONSTRAINT agent_access_requests_reason_length CHECK (reason IS NULL OR char_length(reason) <= 300)
);
--> statement-breakpoint
CREATE INDEX agent_access_requests_session_status_idx ON public.agent_access_requests (session_id, status);
--> statement-breakpoint
CREATE INDEX agent_access_requests_user_idx ON public.agent_access_requests (user_id);
--> statement-breakpoint
ALTER TABLE public.agent_access_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agent_access_requests FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_access_requests TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.agent_access_requests TO service_role;
