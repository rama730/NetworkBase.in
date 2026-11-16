import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { gitBlobSha } from "../../src/lib/github/git-blob";

// COR-007: hydrated bytes must be the blob the manifest recorded.
test("gitBlobSha matches Git's own object ids", () => {
  assert.equal(gitBlobSha(new TextEncoder().encode("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(gitBlobSha(new Uint8Array(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("hydration reads the imported commit, verifies each blob, and never calls partial work done", () => {
  const job = readFileSync("src/inngest/functions/workspace-import-hydrate.ts", "utf8");
  const lib = readFileSync("src/lib/github/import-hydration.ts", "utf8");
  // COR-007: the exact imported commit, and bytes that match the recorded blob.
  assert.match(job, /const ref = \(event\.data\.commitSha as string \| undefined\) \|\| /);
  assert.match(lib, /gitBlobSha\(content\) !== node\.gitHash/);
  // COR-008 (and the 2026-11-16 report): done only when nothing is left without content; a failing run says so.
  assert.match(lib, /status: remaining === 0 \? "done" : "incomplete"/);
  assert.match(job, /onFailure: async/);
  assert.match(job, /syncStatus: "failed"/);
  // The status is a targeted update, so a write of the rest of the import record can't erase it.
  assert.match(lib, /jsonb_set\(/);

  const runner = readFileSync("src/lib/github/workspace-import-runner.ts", "utf8");
  assert.match(runner, /name: "workspace\/import\.hydrate",\s*\/\/[^\n]*\n\s*data: \{ projectId, userId, commitSha: latestSha/);
  // The runner writes its record before queuing hydration, and a failed send marks the import failed.
  assert.ok(runner.indexOf('hydration: { status: "queued"') < runner.indexOf('name: "workspace/import.hydrate"'));
  assert.match(runner, /setHydrationStatus\(projectId, \{ status: "failed"/);
});
