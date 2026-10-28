-- Organizations P14 (report §26.5, §26.11): fourteen org email kinds on the existing queue.
-- data: the template context frozen at queue time (privacy-filtered for the recipient).
-- to_email: invitations to people without an account (E3) have an address and no user.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN (
  'welcome', 'task_assignment',
  'org_ready', 'org_invite', 'org_invite_signup', 'org_welcome', 'org_assignment', 'org_due_soon', 'org_overdue',
  'org_returned', 'org_announcement', 'org_ended', 'org_digest', 'org_removed', 'org_ownership', 'org_deleted'
));
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD COLUMN data jsonb, ADD COLUMN to_email text;
--> statement-breakpoint
ALTER TABLE public.email_outbox ALTER COLUMN user_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_recipient_check CHECK (user_id IS NOT NULL OR to_email IS NOT NULL);
