import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { sql } from "./_helpers";

after(() => sql.end());

// Every published table has a listener and every listener has a published table: a mismatch is silent in the app.
test("the realtime publication matches the tables the code listens to", async () => {
  const rows = await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`;
  const listeners = ["src/lib/realtime/subscriptions.ts", "src/lib/realtime/task-resource.ts", "src/lib/realtime/workspace-files-channel.ts", "src/hooks/useRealtimeTasks.ts", "src/components/workspaces/v2/TasksTab.tsx", "src/components/workspaces/HydrationProgressBanner.tsx"]
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/table: ['"]([a-z_]+)['"]/g)].map((m) => m[1]!));
  assert.deepEqual(rows.map((r) => r.tablename), [...new Set(listeners)].sort());
});
