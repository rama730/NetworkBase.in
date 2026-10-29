import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// SIMPLE-002: the sandbox merge no longer feeds a Git delta queue nothing reads; Git sync owns that path.
test("sandbox merge does not write project_git_deltas", () => {
  assert.doesNotMatch(readFileSync("src/lib/workspaces/merge-sandbox.ts", "utf8"), /workspace_git_deltas|targetBranch/);
  assert.doesNotMatch(readFileSync("src/app/api/v1/workspaces/[id]/tasks/[taskId]/merge/route.ts", "utf8"), /targetBranch/);
});
