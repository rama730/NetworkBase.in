-- 0210: Index cleanup from measured plans and production scan counts (INDEX-001, 002, 004, 005).
-- file_versions_node_version_desc_idx duplicates the unique (node_id, version) index: btree scans
-- either direction, so latest-version lookups use the unique index backward.
DROP INDEX IF EXISTS public.file_versions_node_version_desc_idx;
--> statement-breakpoint
-- Cached workspace counters are only ever read with the profile row; no query orders or filters by
-- them (0 production scans each) so the four standalone indexes only slow every counter update.
DROP INDEX IF EXISTS public.profiles_workspace_inbox_count_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.profiles_workspace_due_today_count_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.profiles_workspace_overdue_count_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.profiles_workspace_in_progress_count_idx;
--> statement-breakpoint
-- Identical to task_comments_task_created_active_idx (same keys, same predicate).
DROP INDEX IF EXISTS public.task_comments_task_created_active_desc_idx;
--> statement-breakpoint
-- The covering feed index stored full update bodies and mutable counters (never scanned). The member
-- feed orders by is_pinned DESC, created_at DESC, id DESC, which no existing index supplies: a
-- 60k-update project read 4,396 buffers (128 ms, sort of every row) and now reads 26 (0.06 ms).
-- The public branch keeps project_updates_public_feed_idx, which fixes visibility.
DROP INDEX IF EXISTS public.project_updates_covering_feed_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_updates_member_feed_idx
  ON public.project_updates (project_id, is_pinned DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
