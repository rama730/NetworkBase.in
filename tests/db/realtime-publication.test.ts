import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// ponytail: screens moved to 0034's broadcasts; these stay published so open old tabs and a redeploy of the
// previous build keep working. upgrade: empty this list and the publication once the signed-in check passes.
test("the realtime publication keeps the old tables during the move", async () => {
  const rows = await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`;
  assert.deepEqual(rows.map((r) => r.tablename), [
    "profiles", "task_comments", "task_node_links", "task_subtasks", "tasks",
    "user_notifications", "workspace_node_locks", "workspace_workflow_columns", "workspaces",
  ]);
});

test("no screen listens to postgres_changes any more", () => {
  for (const file of ["src/lib/realtime/subscriptions.ts", "src/lib/realtime/task-resource.ts", "src/hooks/useRealtimeTasks.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /postgres_changes/, file);
  }
});
