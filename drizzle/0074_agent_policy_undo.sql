-- CLI 2.0 Phase 3 (P3.4, report §26.6, A2.8, A2.9, §44): what AI agents may do without asking in a workspace,
-- a switch that pauses them, single-use "yes" tokens, and undo for changes made with a token.
ALTER TABLE public.workspaces
    ADD COLUMN agent_policy text DEFAULT 'ask_important' NOT NULL,
    ADD COLUMN agents_paused_at timestamp with time zone,
    ADD CONSTRAINT workspaces_agent_policy_check CHECK (agent_policy = ANY (ARRAY['ask_important'::text, 'ask_all'::text, 'trust_drafts_docs'::text]));
--> statement-breakpoint
CREATE TABLE public.agent_confirmations_used (
    token_hash text NOT NULL PRIMARY KEY,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.undo_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id uuid,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    operation text NOT NULL,
    summary text NOT NULL,
    inverse jsonb NOT NULL,
    via text,
    agent_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX undo_operations_user_created_idx ON public.undo_operations (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX undo_operations_session_idx ON public.undo_operations (session_id) WHERE session_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.agent_confirmations_used ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.undo_operations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agent_confirmations_used, public.undo_operations FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_confirmations_used, public.undo_operations TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.agent_confirmations_used, public.undo_operations TO service_role;
