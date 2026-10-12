-- 0211: Discover index hygiene (discover audit #92, #93).
--
-- 1. Fail loudly if a Discover index is invalid. A failed CREATE INDEX CONCURRENTLY leaves an invalid index
--    behind, and IF NOT EXISTS would then skip it forever. The repair is a DROP INDEX CONCURRENTLY and a
--    re-create, done by hand, after which this migration is re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname LIKE 'projects_discover_%' AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'A projects_discover_* index is invalid: DROP INDEX CONCURRENTLY it, re-create it, then re-run 0211';
  END IF;
END $$;
--> statement-breakpoint
-- 2. Drop the feed indexes that 0195 replaced and that nothing scans (live idx_scan = 0). They still cost a write
--    on every insert and update. The other older feed indexes still take traffic from the running code: they stay
--    until that code is gone.
DROP INDEX CONCURRENTLY IF EXISTS public.projects_feed_newest_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.projects_public_feed_newest_active_idx;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.projects_public_feed_most_viewed_active_idx;
