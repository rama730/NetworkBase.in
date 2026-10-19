-- 0217: at most one pinned (live) update per project (COR-046).
-- First reconcile existing data: where a project has several live pins, keep the most recently
-- updated one and unpin the rest. Then enforce it with a partial unique index, built concurrently
-- so project_updates stays writable during the build (this migration is non-transactional).
UPDATE public.project_updates u
SET is_pinned = false
WHERE u.is_pinned
  AND u.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.project_updates newer
    WHERE newer.project_id = u.project_id
      AND newer.is_pinned
      AND newer.deleted_at IS NULL
      AND (newer.updated_at, newer.id) > (u.updated_at, u.id)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS project_updates_one_live_pin_idx
  ON public.project_updates (project_id)
  WHERE is_pinned AND deleted_at IS NULL;
