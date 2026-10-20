import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectActionsSource } from "./_project-actions-source";

test("project preflight and finalization ignore soft-deleted tasks", () => {
  const source = projectActionsSource();
  const unfinishedPredicates = source.match(
    /eq\(tasks\.projectId, projectId\),\s*isNull\(tasks\.deletedAt\),\s*sql`\(\$\{tasks\.status\} <> 'done' OR \$\{tasks\.reviewStatus\} = 'pending'\)`/g,
  ) ?? [];

  assert.ok(unfinishedPredicates.length >= 2);
});
