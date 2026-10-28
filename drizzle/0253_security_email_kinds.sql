-- Account-security and deletion emails use the existing email outbox: eight new kinds.
-- They are sent whatever the email switch says, and the deletion ones also reach a profile whose deletion is
-- scheduled. Only the kind check changes; no data moves.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN (
  'welcome', 'task_assignment',
  'org_ready', 'org_invite', 'org_invite_signup', 'org_welcome', 'org_assignment', 'org_due_soon', 'org_overdue',
  'org_returned', 'org_announcement', 'org_ended', 'org_digest', 'org_removed', 'org_ownership', 'org_deleted',
  'security_password_changed', 'security_mfa_changed', 'security_token_created', 'security_sessions_revoked', 'security_sign_in_method_changed',
  'account_deletion_scheduled', 'account_deletion_cancelled', 'account_deletion_reminder'
));
