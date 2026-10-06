-- COR-053: one phase per cleanup_status value. The overloaded 'in_progress'
-- meant both "storage scheduling running" and "database deleted, Auth pending";
-- 'completed' meant both "storage scheduled" and "account deleted".
UPDATE public.account_deletions SET cleanup_status = CASE
  WHEN completed_at IS NOT NULL THEN 'completed'
  WHEN cleanup_status = 'in_progress' AND cleanup_details ? 'databaseCleanupAt' THEN 'db_deleted'
  WHEN cleanup_status = 'in_progress' THEN 'storage_running'
  WHEN cleanup_status = 'completed' THEN 'storage_scheduled'
  ELSE cleanup_status
END;
--> statement-breakpoint
ALTER TABLE public.account_deletions
  ADD CONSTRAINT account_deletions_cleanup_status_check
  CHECK (cleanup_status IN ('pending', 'storage_running', 'storage_scheduled', 'db_deleted', 'completed', 'failed'));
--> statement-breakpoint
-- DB-007: email-link confirmation was retired; nothing reads these.
ALTER TABLE public.account_deletions DROP COLUMN IF EXISTS confirmation_token;
--> statement-breakpoint
ALTER TABLE public.account_deletions DROP COLUMN IF EXISTS token_expires_at;
