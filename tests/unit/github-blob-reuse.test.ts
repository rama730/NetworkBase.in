import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reusableBlobSha } from "../../src/lib/github/blob-reuse";

// COR-041
test("a recorded blob sha is reused only for identical verified content", () => {
  const known = { localBlobSha: "aaaa", localHash: "hash-1" };
  assert.equal(reusableBlobSha(known, "hash-1"), "aaaa");
  assert.equal(reusableBlobSha(known, "hash-2"), null, "a replacement file at the same path/node is not the recorded content");
  assert.equal(reusableBlobSha(known, null), null, "unknown content cannot be vouched for");
  assert.equal(reusableBlobSha({ localBlobSha: "aaaa", localHash: null }, "hash-1"), null);
  assert.equal(reusableBlobSha({ localBlobSha: null, localHash: "hash-1" }, "hash-1"), null);
  assert.equal(reusableBlobSha(undefined, "hash-1"), null);
});

test("compare no longer trusts node id, path or version 1 as content identity", () => {
  const source = readFileSync("src/lib/github/sync-service.ts", "utf8");
  const compare = source.slice(source.indexOf("// Fast path 1"), source.indexOf("// Fast path 5"));
  assert.doesNotMatch(compare, /knownByNodeId\.has|knownByPath\.has/);
  assert.doesNotMatch(compare, /previous\.localBlobSha &&/);
  assert.match(compare, /reusableBlobSha\(previous, localHash\)/);
});
