-- Wave 1: Database Schema Hardening, Missing Indexes & Consistency Constraints (1M Scale)

-- 1. Covering index for notification_deliveries (Item 97)
CREATE INDEX IF NOT EXISTS "notification_deliveries_user_status_covering_idx"
ON "notification_deliveries" ("user_id", "status", "attempted_at" DESC)
INCLUDE ("id", "notification_id");

-- 2. Composite index on connections for fast status lookups (Item 105)
CREATE INDEX IF NOT EXISTS "connections_req_addr_status_idx"
ON "connections" ("requester_id", "addressee_id", "status");

-- 3. Partial index on active project nodes for parent-child listings (Item 98)
CREATE INDEX IF NOT EXISTS "project_nodes_active_parent_idx"
ON "project_nodes" ("project_id", "parent_id")
WHERE "deleted_at" IS NULL;

-- 4. Composite index on task comments for chronological active threads (Item 100)
CREATE INDEX IF NOT EXISTS "task_comments_task_created_active_desc_idx"
ON "task_comments" ("task_id", "created_at" DESC)
WHERE "deleted_at" IS NULL;

-- 5. Like count & comment count non-negative check constraints on project_updates (Item 103)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_updates_like_count_nonnegative'
  ) THEN
    ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_like_count_nonnegative" CHECK ("like_count" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_updates_comment_count_nonnegative'
  ) THEN
    ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_comment_count_nonnegative" CHECK ("comment_count" >= 0);
  END IF;
END $$;
