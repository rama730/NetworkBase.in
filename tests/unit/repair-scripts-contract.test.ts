import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("hash backfill is a dry run unless --apply and never certifies mutable-key history (COR-064)", () => {
  const source = readFileSync("scripts/db/repair/backfill-file-hashes.ts", "utf8");
  assert.match(source, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.ok(source.indexOf("if (!APPLY)") < source.indexOf("createAdminClient()", source.indexOf("async function main")));
  assert.match(source, /sharesMutableKey = row\.s3Key === row\.currentS3Key && row\.contentHash == null/);
  assert.match(source, /!isCurrentRevision && \(metadataChanged \|\| sharesMutableKey\)/);
});

// DB tool layout: scripts/db/inspect only reads; every scripts/db/repair tool
// is a dry run unless --apply is passed.
test("repair tools default to a dry run and inspect tools only read", () => {
  const dir = (name: string) => readdirSync(`scripts/db/${name}`).filter((file) => file.endsWith(".ts"));
  assert.ok(dir("repair").length > 0);
  for (const file of dir("repair")) {
    assert.match(readFileSync(`scripts/db/repair/${file}`, "utf8"), /const APPLY = process\.argv\.includes\(["']--apply["']\)/, file);
  }
  for (const file of dir("inspect")) {
    const source = readFileSync(`scripts/db/inspect/${file}`, "utf8");
    assert.doesNotMatch(source, /\b(INSERT INTO|DELETE FROM|ALTER TABLE|DROP |TRUNCATE)\b|^\s*UPDATE\s/m, file);
    assert.doesNotMatch(source, /\.(insert|update|delete)\(/, file);
  }
});
