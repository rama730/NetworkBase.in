import assert from "node:assert/strict";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// INDEX-001/002/004/005 (0210): indexes proven redundant or unused stay gone; the member feed has
// an index that supplies its exact sort.
const names = async () => new Set((await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`).map((r) => r.indexname as string));

test("redundant and unused indexes are dropped", async () => {
  const present = await names();
  for (const dropped of [
    "file_versions_node_version_desc_idx",
    "profiles_workspace_inbox_count_idx",
    "profiles_workspace_due_today_count_idx",
    "profiles_workspace_overdue_count_idx",
    "profiles_workspace_in_progress_count_idx",
    "task_comments_task_created_active_desc_idx",
    "project_updates_covering_feed_idx",
  ]) assert.equal(present.has(dropped), false, dropped);
  assert.ok(present.has("file_versions_node_version_unique"));
  assert.ok(present.has("task_comments_task_created_active_idx"));
});

test("member update feed index matches the feed's ORDER BY and live-row filter", async () => {
  const [row] = await sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'workspace_updates_member_feed_idx'`;
  assert.match(row!.indexdef, /\(workspace_id, is_pinned DESC, created_at DESC, id DESC\) WHERE \(deleted_at IS NULL\)/);
});
