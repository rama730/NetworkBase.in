-- CLI 2.0 Phase 3 (P3.1, report A3.1–A3.3, §44): sign-in with a code for terminals without a browser (SSH,
-- containers, cloud agents), and agent tokens (nb_agt_) that are tied to one workspace. A device code row keeps only
-- the hash of the code the CLI polls with; the token itself is made once, when the approved CLI polls, and only its
-- hash is stored (in extension_device_sessions).
ALTER TABLE public.extension_device_sessions
    ADD COLUMN token_type text DEFAULT 'device' NOT NULL,
    ADD COLUMN agent_name text,
    ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.extension_device_sessions
    ADD CONSTRAINT extension_device_sessions_token_type_check CHECK (token_type = ANY (ARRAY['device'::text, 'agent'::text])),
    ADD CONSTRAINT extension_device_sessions_agent_workspace_check CHECK (token_type <> 'agent' OR workspace_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.personal_access_tokens
    ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE public.device_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    device_code_hash text NOT NULL UNIQUE,
    user_code text NOT NULL UNIQUE,
    client_name text NOT NULL,
    device_name text NOT NULL,
    client_version text,
    platform text,
    requested_type text DEFAULT 'device' NOT NULL,
    agent_name text,
    ip_address text,
    user_agent text,
    status text DEFAULT 'pending' NOT NULL,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    token_type text,
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
    scopes jsonb,
    token_expires_at timestamp with time zone,
    session_id uuid REFERENCES public.extension_device_sessions(id) ON DELETE SET NULL,
    last_polled_at timestamp with time zone,
    decided_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_codes_requested_type_check CHECK (requested_type = ANY (ARRAY['device'::text, 'agent'::text])),
    CONSTRAINT device_codes_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'consumed'::text])),
    CONSTRAINT device_codes_token_type_check CHECK (token_type IS NULL OR token_type = ANY (ARRAY['device'::text, 'agent'::text]))
);
--> statement-breakpoint
CREATE INDEX device_codes_expires_idx ON public.device_codes (expires_at);
--> statement-breakpoint
ALTER TABLE public.device_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.device_codes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_codes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.device_codes TO service_role;
