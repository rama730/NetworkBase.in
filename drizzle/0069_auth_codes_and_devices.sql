-- Sign-in pages (docs/superpowers/plans/2026-11-09-auth-pages-findings.md): password reset and sign-in codes sent by
-- the app (they work on any device), the "new sign-in" email, and the browsers a person signed in from (A2, B11,
-- C17, C18). A browser carries a random id in a cookie; only its hash is kept here.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK ((kind = ANY (ARRAY['welcome'::text, 'task_assignment'::text, 'org_ready'::text, 'org_invite'::text, 'org_invite_signup'::text, 'org_welcome'::text, 'org_assignment'::text, 'org_due_soon'::text, 'org_overdue'::text, 'org_returned'::text, 'org_announcement'::text, 'org_ended'::text, 'org_digest'::text, 'org_removed'::text, 'org_ownership'::text, 'org_deleted'::text, 'org_verify_code'::text, 'security_password_changed'::text, 'security_mfa_changed'::text, 'security_token_created'::text, 'security_sessions_revoked'::text, 'security_sign_in_method_changed'::text, 'account_deletion_scheduled'::text, 'account_deletion_cancelled'::text, 'account_deletion_reminder'::text, 'account_deletion_completed'::text, 'trust_person'::text, 'trust_staff'::text, 'auth_reset_code'::text, 'auth_sign_in_code'::text, 'security_new_sign_in'::text])));;
--> statement-breakpoint
CREATE TABLE public.user_devices (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_hash text NOT NULL,
    label text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    trusted_until timestamp with time zone,
    CONSTRAINT user_devices_pkey PRIMARY KEY (user_id, device_hash)
);
--> statement-breakpoint
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.user_devices FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_devices TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.user_devices TO service_role;
