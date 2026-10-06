-- 0195: Discover feed indexes (Discover audit #111). The feed reads public, non-draft, live projects
-- newest first, or by views / followers. The old composite indexes lead with visibility and status, so
-- they can't supply that order (production shows 0 scans). Partial indexes whose predicate is exactly
-- the feed's filter can, for every page (keyset cursor on created_at, id). Built CONCURRENTLY: no
-- write lock on projects.
UPDATE public.projects SET view_count = 0 WHERE view_count IS NULL;
--> statement-breakpoint
ALTER TABLE public.projects ALTER COLUMN view_count SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.projects ALTER COLUMN view_count SET NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_discover_newest_idx
  ON public.projects (created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_discover_most_viewed_idx
  ON public.projects (view_count DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft';
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_discover_most_followed_idx
  ON public.projects (followers_count DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft';
