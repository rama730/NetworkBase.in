import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

test("sprint linked-file lookup binds task IDs as individual UUID values", async () => {
  const source = projectActionsSource();
  const linkedFilesQuery = source.slice(
    source.indexOf('FROM task_node_links tnl'),
    source.indexOf('ORDER BY tnl.linked_at DESC', source.indexOf('FROM task_node_links tnl')),
  );

  assert.match(linkedFilesQuery, /WHERE tnl\.task_id IN \(\$\{sql\.join\(taskIds\.map\(\(taskId\) => sql`\$\{taskId\}::uuid`\), sql`, `\)\}\)/);
  assert.doesNotMatch(linkedFilesQuery, /ANY\(\$\{taskIds\}::uuid\[\]\)/);
});
