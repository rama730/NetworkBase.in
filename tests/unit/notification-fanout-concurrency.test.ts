import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// PERF-004: write concurrency is per chunk, so chunks must not run side by side.
test("notification fan-out delivers chunks sequentially", () => {
  const source = readFileSync("src/lib/notifications/fanout.ts", "utf8");
  const emit = source.slice(source.indexOf("export async function emitNotificationWrites"));
  assert.doesNotMatch(emit, /Promise\.all\(chunks\.map/);
  assert.match(emit, /for \(const \[index, chunk\] of chunks\.entries\(\)\)/);
});
