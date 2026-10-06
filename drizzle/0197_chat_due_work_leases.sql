-- COR-010: a scheduled message or reminder is marked done only after it was
-- delivered. Claims are short leases; a crashed worker's claim expires and the
-- item is retried (sends are idempotent by client id, notifications by dedupe key).
ALTER TABLE public.chat_scheduled_messages ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.chat_saved ADD COLUMN IF NOT EXISTS reminder_claim_expires_at timestamptz;
