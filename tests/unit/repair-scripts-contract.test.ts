import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("hash backfill is a dry run unless --apply and never certifies mutable-key history (COR-064)", () => {
  const source = readFileSync("scripts/backfill-file-hashes.ts", "utf8");
  assert.match(source, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.ok(source.indexOf("if (!APPLY)") < source.indexOf("createAdminClient()", source.indexOf("async function main")));
  assert.match(source, /sharesMutableKey = row\.s3Key === row\.currentS3Key && row\.contentHash == null/);
  assert.match(source, /!isCurrentRevision && \(metadataChanged \|\| sharesMutableKey\)/);
});
