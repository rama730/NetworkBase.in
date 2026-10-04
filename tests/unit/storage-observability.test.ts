import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  normalizeStorageQueueRow,
  STORAGE_QUEUE_DEPTH_LIMIT,
} from "../../src/lib/storage/storage-observability-contract";

describe("storage queue observability", () => {
  it("caps depth while preserving the overload signal", () => {
    assert.deepEqual(normalizeStorageQueueRow({
      queue: "backup",
      depth: String(STORAGE_QUEUE_DEPTH_LIMIT + 1),
      oldest_at: "2026-10-01T00:00:00.000Z",
    }, Date.parse("2026-10-01T00:05:00.000Z")), {
      queue: "backup",
      depth: STORAGE_QUEUE_DEPTH_LIMIT,
      capped: true,
      oldestAgeMs: 300_000,
    });
  });

  it("normalizes empty and future queues safely", () => {
    assert.deepEqual(normalizeStorageQueueRow({
      queue: "deletion",
      depth: 0,
      oldest_at: null,
    }, 1_000), {
      queue: "deletion",
      depth: 0,
      capped: false,
      oldestAgeMs: 0,
    });
    assert.equal(normalizeStorageQueueRow({
      queue: "repair",
      depth: 1,
      oldest_at: new Date(2_000),
    }, 1_000).oldestAgeMs, 0);
  });

  it("keeps every queue scan bounded", () => {
    const source = readFileSync(new URL("../../src/lib/storage/observability.ts", import.meta.url), "utf8");
    assert.equal((source.match(/LIMIT \$\{READ_LIMIT\}/g) ?? []).length, 6);
    assert.match(source, /storage\.queue\.snapshot/);
  });
});
