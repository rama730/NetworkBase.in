import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { gitBlobSha } from "../../src/lib/github/git-blob";

// COR-007: hydrated bytes must be the blob the manifest recorded.
test("gitBlobSha matches Git's own object ids", () => {
  assert.equal(gitBlobSha(new TextEncoder().encode("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(gitBlobSha(new Uint8Array(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("hydration reads the imported commit, verifies each blob, and does not finish partial work as ready", () => {
  const hydrate = readFileSync("src/inngest/functions/workspace-import-hydrate.ts", "utf8");
  assert.match(hydrate, /const ref = commitSha \?\? branch/);
  assert.match(hydrate, /gitBlobSha\(file\.content\) !== node\.gitHash/);
  // COR-008: failures retry the step; only a fully hydrated project becomes ready.
  assert.match(hydrate, /if \(failed > 0\) \{[\s\S]*throw new Error\(`Hydration incomplete/);
  assert.ok(hydrate.indexOf("throw new Error(`Hydration incomplete") < hydrate.lastIndexOf('syncStatus: "ready"'));
  assert.match(hydrate, /onFailure: async/);
  assert.match(hydrate, /syncStatus: "failed"/);

  const runner = readFileSync("src/lib/github/workspace-import-runner.ts", "utf8");
  assert.match(runner, /name: "workspace\/import\.hydrate",\s*\/\/[^\n]*\n\s*data: \{ projectId, userId, commitSha: latestSha/);
  assert.match(runner, /hydrationDispatchError \? "failed" : "ready"/);
});
