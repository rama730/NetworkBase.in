import assert from "node:assert/strict";
import { test } from "node:test";

import { dueRitual, nextAt, repeatWords, type Ritual } from "../../src/lib/organizations/rituals";

const base: Ritual = { id: "wins", name: "Weekly wins", kind: "thread", freq: "weekly", weekday: 5, time: "17:00", hostId: "00000000-0000-4000-8000-000000000001", prompt: "Share a win", leadDays: 0, paused: false, createdAt: "2026-11-01T00:00:00Z" };

test("34.5 call 7: a weekly thread is due once its time has come in the community's zone, and only once", () => {
  // Fri 27 Nov 2026, 17:00 in Kolkata = 11:30 UTC.
  const before = new Date("2026-11-27T11:00:00Z");
  const after = new Date("2026-11-27T11:45:00Z");
  assert.equal(dueRitual({ ...base, lastPostedFor: "2026-11-20T11:30:00.000Z" }, before, "Asia/Kolkata"), null);
  const due = dueRitual({ ...base, lastPostedFor: "2026-11-20T11:30:00.000Z" }, after, "Asia/Kolkata");
  assert.equal(due?.at, "2026-11-27T11:30:00.000Z");
  assert.equal(dueRitual({ ...base, lastPostedFor: due!.at }, after, "Asia/Kolkata"), null, "posted: not again");
  assert.equal(dueRitual({ ...base, paused: true }, after, "Asia/Kolkata"), null, "paused");
  assert.equal(dueRitual({ ...base, createdAt: "2026-11-27T12:00:00Z" }, after, "Asia/Kolkata"), null, "nothing from before it existed");
  assert.equal(nextAt(base, after, "Asia/Kolkata"), "2026-12-04T11:30:00.000Z");
  assert.equal(repeatWords(base), "Every Friday at 17:00");
});

test("34.5 call 8: Ask me anything posts lead days early; monthly means the first weekday of the month", () => {
  const ama: Ritual = { ...base, id: "ama", kind: "ama", freq: "monthly", weekday: 4, time: "19:00", leadDays: 3, lastPostedFor: "2026-11-05T19:00:00.000Z" };
  // First Thursday of December 2026 is Dec 3; 19:00 UTC; questions open Nov 30 19:00.
  assert.equal(dueRitual(ama, new Date("2026-11-30T18:00:00Z"), "UTC"), null);
  assert.equal(dueRitual(ama, new Date("2026-11-30T19:30:00Z"), "UTC")?.at, "2026-12-03T19:00:00.000Z");
  assert.equal(nextAt(ama, new Date("2026-12-04T00:00:00Z"), "UTC"), "2027-01-07T19:00:00.000Z");
  assert.equal(repeatWords(ama), "First Thursday of the month at 19:00");
});
