-- OAuth for the hosted MCP server (/api/mcp, MCP authorization spec 2025-06-18): editors register themselves
-- (RFC 7591), send the person to /oauth/authorize, and swap the code for an agent token at /api/oauth/token with PKCE.
-- The approval reuses the device sign-in page and its device_codes row, so an editor gets the same workspace-bound
-- agent token as `nb login --device --agent`.

CREATE TABLE public.oauth_clients (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    client_name text NOT NULL,
    redirect_uris jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT oauth_clients_name_length CHECK (char_length(client_name) BETWEEN 1 AND 100),
    CONSTRAINT oauth_clients_redirect_uris_array CHECK (jsonb_typeof(redirect_uris) = 'array' AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 10)
);
--> statement-breakpoint
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.oauth_clients FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_clients TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.oauth_clients TO service_role;
--> statement-breakpoint
-- An authorization request is a device code with where to send the person back and the PKCE challenge; approving it
-- stores a one-time authorization code (hashed) that the token endpoint swaps for the token.
ALTER TABLE public.device_codes
    ADD COLUMN oauth_client_id uuid REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    ADD COLUMN redirect_uri text,
    ADD COLUMN oauth_state text,
    ADD COLUMN code_challenge text,
    ADD COLUMN oauth_code_hash text UNIQUE;
--> statement-breakpoint
CREATE INDEX device_codes_oauth_client_idx ON public.device_codes (oauth_client_id) WHERE oauth_client_id IS NOT NULL;
