-- 0242: the Discover feed reads public project updates newest-first across all projects
-- (WHERE visibility = 'public' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC). Every other index on
-- project_updates starts with project_id or author_id, so that read sorted the whole table. This one serves
-- the sort and the keyset cursor directly. Built concurrently, so this migration is non-transactional.
CREATE INDEX CONCURRENTLY IF NOT EXISTS project_updates_discover_feed_idx
  ON public.project_updates (created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND visibility = 'public';
