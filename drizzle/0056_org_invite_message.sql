-- Report §7.11 (step 6 gap): an email invite can carry a short personal message from whoever sent it.
ALTER TABLE public.org_email_invites ADD COLUMN message text;
--> statement-breakpoint
ALTER TABLE public.org_email_invites ADD CONSTRAINT org_email_invites_message_check CHECK (message IS NULL OR char_length(message) <= 500);
