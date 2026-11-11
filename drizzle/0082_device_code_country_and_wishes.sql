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
