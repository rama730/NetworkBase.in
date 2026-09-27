-- 0164_extension_indexes_and_redis_locks.sql
-- WorkSpace IDE Extension Scale Optimization & Index Hardening (1,000,000 Concurrent Developers)

-- 1. Root project node lookup acceleration (eliminates Seq Scan in workspace route)
CREATE INDEX IF NOT EXISTS "idx_project_nodes_root_covering"
ON "project_nodes" ("project_id", "type", "name")
WHERE "parent_id" IS NULL AND "deleted_at" IS NULL;

-- 2. Recovery session lookup by user and device (accelerates heartbeat lookups)
CREATE INDEX IF NOT EXISTS "idx_recovery_sessions_user_device"
ON "extension_recovery_sessions" ("user_id", "session_id", "device_id");

-- 3. Recovery drafts historical path lookup
CREATE INDEX IF NOT EXISTS "idx_recovery_drafts_path_time"
ON "extension_recovery_drafts" ("user_id", "project_id", "path", "captured_at" DESC);

-- 4. Ephemeral lock expiration cleanup index
CREATE INDEX IF NOT EXISTS "idx_project_node_locks_expires"
ON "project_node_locks" ("expires_at")
WHERE "expires_at" IS NOT NULL;

-- 5. Task node links fast composite lookup
CREATE INDEX IF NOT EXISTS "idx_task_node_links_project_task"
ON "task_node_links" ("project_id", "task_id")
WHERE "deleted_at" IS NULL;

-- 6. Project files Git sync local and remote SHA covering indexes
CREATE INDEX IF NOT EXISTS "github_sync_files_local_sha_idx"
ON "github_sync_files" ("project_id", "local_blob_sha");

CREATE INDEX IF NOT EXISTS "github_sync_files_blob_sha_idx"
ON "github_sync_files" ("project_id", "blob_sha");

-- 7. Upload intents project status composite index
CREATE INDEX IF NOT EXISTS "upload_intents_project_status_idx"
ON "upload_intents" ("project_id", "status");

-- 8. Project nodes permanent delete root partial index
CREATE INDEX IF NOT EXISTS "idx_project_nodes_perm_del"
ON "project_nodes" ("project_id", (metadata->>'permanentDeleteRoot'))
WHERE "deleted_at" IS NOT NULL;

