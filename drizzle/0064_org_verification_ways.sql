-- Organization address, Discover and the verified badge (2026-11-05-org-address-discovery-verification-findings.md
-- §5, §7): four ways to verify. The badge records how it was earned and what it was checked against ("rvce.edu.in",
-- "Part of Northgate Institute", "github.com/acme"); rechecks follow the way it was earned.
ALTER TABLE public.workspaces ADD COLUMN verification_method text;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD COLUMN verified_against text;
--> statement-breakpoint
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_verification_method_check CHECK (verification_method IS NULL OR verification_method = ANY (ARRAY['owner_email'::text, 'email'::text, 'parent'::text, 'website'::text, 'github'::text, 'dns'::text, 'team'::text]));
--> statement-breakpoint
-- Badges given before this release keep working: a domain one was the owner's email matching the website.
UPDATE public.workspaces SET verification_method = CASE WHEN verification_domain IS NOT NULL THEN 'owner_email' ELSE 'team' END,
    verified_against = verification_domain
  WHERE kind = 'organization' AND verified_at IS NOT NULL;
--> statement-breakpoint
-- Way 1: a 6-digit code sent to an address on the organization's domain. Only its SHA-256 is kept; one code per
-- organization at a time, 10 minutes, 5 tries; `sends` holds the last hour's sends (3 at most).
CREATE TABLE public.org_verification_codes (
    org_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    email text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    sends timestamp with time zone[] DEFAULT '{}'::timestamp with time zone[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_verification_codes_code_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT org_verification_codes_email_check CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
--> statement-breakpoint
ALTER TABLE public.org_verification_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.org_verification_codes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_verification_codes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.org_verification_codes TO service_role;
--> statement-breakpoint
-- The code's email goes to an address that may have no account, like an invitation.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK ((kind = ANY (ARRAY['welcome'::text, 'task_assignment'::text, 'org_ready'::text, 'org_invite'::text, 'org_invite_signup'::text, 'org_welcome'::text, 'org_assignment'::text, 'org_due_soon'::text, 'org_overdue'::text, 'org_returned'::text, 'org_announcement'::text, 'org_ended'::text, 'org_digest'::text, 'org_removed'::text, 'org_ownership'::text, 'org_deleted'::text, 'org_verify_code'::text, 'security_password_changed'::text, 'security_mfa_changed'::text, 'security_token_created'::text, 'security_sessions_revoked'::text, 'security_sign_in_method_changed'::text, 'account_deletion_scheduled'::text, 'account_deletion_cancelled'::text, 'account_deletion_reminder'::text, 'account_deletion_completed'::text, 'trust_person'::text, 'trust_staff'::text])));
--> statement-breakpoint
-- Way 4 (D4): an optional document for the team's review. Private; only the server reads it, and it's deleted 30 days
-- after the decision.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('org-verification-documents', 'org-verification-documents', 'f', 4194304, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) ON CONFLICT (id) DO NOTHING;
