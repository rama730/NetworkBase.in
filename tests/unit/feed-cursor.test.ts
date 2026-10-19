import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeByTime, parseFeedCursor } from "@/lib/messaging/inbox";

const cursor = (at: string, seq: number, rank: number, tie = "", scope = "all") =>
  JSON.stringify([at, "11111111-1111-1111-1111-111111111111", seq, rank, tie, scope]);
const row = (id: string, key: string) => ({ id, created_at: "2026-01-01T00:00:00Z", cursor: key });

// COR-056: equal times order by the full key, the same way the database does.
test("rows with the same time merge in key order, newest key first", () => {
  const at = "2026-01-01T00:00:00.500000Z";
  const merged = mergeByTime(
    [row("m5", cursor(at, 5, 0)), row("m3", cursor(at, 3, 0))],
    [row("r3b", cursor(at, 3, 1, "u:b")), row("r3a", cursor(at, 3, 1, "u:a")), row("r9", cursor(at, 9, 1, "u:a"))],
    10,
  );
  assert.deepEqual(merged.map((x) => x.id), ["r9", "m5", "r3b", "r3a", "m3"]);
});

test("a cursor is accepted only for its own feed and only when well formed", () => {
  const good = cursor("2026-01-01T00:00:00.000001Z", 1, 0);
  assert.deepEqual(parseFeedCursor(good, "all")?.[2], 1);
  assert.equal(parseFeedCursor(good, "threads"), "invalid");
  assert.equal(parseFeedCursor(null, "all"), null);
  assert.equal(parseFeedCursor("", "all"), null);
  for (const bad of ["{}", "[]", "not json", cursor("yesterday", 1, 0), JSON.stringify(["2026-01-01T00:00:00.000001Z", "nope", 1, 0, "", "all"])]) {
    assert.equal(parseFeedCursor(bad, "all"), "invalid", bad);
  }
  assert.notEqual(parseFeedCursor(cursor("-infinity", 1, 0, "", "threads"), "threads"), "invalid");
});
