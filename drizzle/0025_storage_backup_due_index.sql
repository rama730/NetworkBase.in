-- The backup job orders by failed-last then oldest; the old index (verified_at, id) was never used, so every run scanned and sorted the table.
DROP INDEX public.storage_assets_backup_due_idx;
--> statement-breakpoint
CREATE INDEX storage_assets_backup_due_idx ON public.storage_assets USING btree ((last_error_code IS NOT NULL), updated_at, id)
  WHERE backup_state = 'pending' AND state IN ('verified', 'delete_pending');
