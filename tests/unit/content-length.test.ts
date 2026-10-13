import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reportedContentLength } from "../../src/lib/http/content-length";

// COR-019
test("a missing or unusable Content-Length is unknown, never zero", () => {
  assert.equal(reportedContentLength(new Headers()), null);
  assert.equal(reportedContentLength(new Headers({ "content-length": "" })), null);
  assert.equal(reportedContentLength(new Headers({ "content-length": "abc" })), null);
  assert.equal(reportedContentLength(new Headers({ "content-length": "-5" })), null);
  assert.equal(reportedContentLength(new Headers({ "content-length": "0" })), 0);
  assert.equal(reportedContentLength(new Headers({ "content-length": "1048576" })), 1048576);
});

test("backup, upload verification and bounded reads use it instead of Number(header)", () => {
  for (const file of ["src/lib/storage/asset-backup.ts", "src/lib/upload/upload-intents.ts", "src/lib/storage/bounded-object-read.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /reportedContentLength\(/, file);
    assert.doesNotMatch(source, /Number\([^)]*get\("content-length"\)\)/, file);
  }
});

// COR-018 (backup queue): failed assets rotate behind fresh ones and wait out a retry window.
test("the backup selector puts never-failed assets first and stamps failures", () => {
  const backup = readFileSync("src/lib/storage/asset-backup.ts", "utf8");
  assert.match(backup, /BACKUP_RETRY_AFTER/);
  assert.match(backup, /\(\$\{storageAssets\.lastErrorCode\} IS NOT NULL\)/);
  assert.match(backup, /lastErrorCode: "backup_failed"/);
});
