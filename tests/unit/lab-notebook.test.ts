import assert from "node:assert/strict";
import { test } from "node:test";

import { entryLock, entrySchema, isLocked } from "../../src/lib/organizations/lab-notebook";

test("35.5 call 3: an entry locks at the end of its day in the lab's zone; yesterday once, as written later", () => {
  const now = new Date("2026-11-26T20:00:00Z"); // 01:30 on Nov 27 in Kolkata
  assert.deepEqual(entryLock("2026-11-27", "Asia/Calcutta", now), { locksAt: "2026-11-27T18:30:00.000Z", writtenLater: false });
  assert.deepEqual(entryLock("2026-11-26", "Asia/Calcutta", now), { locksAt: "2026-11-27T18:30:00.000Z", writtenLater: true });
  assert.equal(entryLock("2026-11-25", "Asia/Calcutta", now), null, "older days are refused");
  assert.equal(entryLock("2026-11-28", "Asia/Calcutta", now), null, "no future days");
  assert.equal(isLocked("2026-11-27T18:30:00.000Z", new Date("2026-11-27T18:30:00Z")), true);
});

test("entries take typed http links only (never fetched)", () => {
  const base = { title: "Run 7", day: "2026-11-27", aim: "", inputs: "", steps: "", deviations: "", results: "", next: "", protocolDocId: null, experimentId: null };
  assert.equal(entrySchema.safeParse({ ...base, links: ["https://drive.example.com/x"] }).success, true);
  assert.equal(entrySchema.safeParse({ ...base, links: ["javascript:alert(1)"] }).success, false);
  assert.equal(entrySchema.safeParse({ ...base, links: [], extra: 1 }).success, false);
});
