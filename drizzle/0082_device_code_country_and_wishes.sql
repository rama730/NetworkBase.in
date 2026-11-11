-- One-click agent sign-in (report Part A, A2/A5/A10): the approval page shows the country a sign-in came from, and
-- pre-fills the access the CLI or editor asked for (Full help, Small changes or Read only; one workspace or all).

ALTER TABLE public.device_codes
    ADD COLUMN country text,
    ADD COLUMN requested_access text,
    ADD COLUMN requested_workspace text;
--> statement-breakpoint
ALTER TABLE public.device_codes
    ADD CONSTRAINT device_codes_country_check CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT device_codes_requested_access_check CHECK (requested_access IS NULL OR requested_access = ANY (ARRAY['full'::text, 'small'::text, 'read'::text])),
    ADD CONSTRAINT device_codes_requested_workspace_check CHECK (requested_workspace IS NULL OR requested_workspace = 'all' OR requested_workspace ~ '^[0-9a-f-]{36}$');
--> statement-breakpoint
-- "All my workspaces" is an explicit choice, never a forgotten workspace: an agent sign-in has exactly one of a
-- workspace or all_workspaces = true (replaces the 0072 rule that every agent sign-in has a workspace).
ALTER TABLE public.extension_device_sessions ADD COLUMN all_workspaces boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE public.extension_device_sessions DROP CONSTRAINT extension_device_sessions_agent_workspace_check;
--> statement-breakpoint
ALTER TABLE public.extension_device_sessions
    ADD CONSTRAINT extension_device_sessions_agent_workspace_check CHECK (token_type <> 'agent' OR ((workspace_id IS NOT NULL) <> all_workspaces)),
    ADD CONSTRAINT extension_device_sessions_all_workspaces_agent_only CHECK (NOT all_workspaces OR token_type = 'agent');
--> statement-breakpoint
ALTER TABLE public.device_codes ADD COLUMN all_workspaces boolean DEFAULT false NOT NULL;
