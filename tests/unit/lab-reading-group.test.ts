import assert from "node:assert/strict";
import { test } from "node:test";

import { nextPresenter, nextSlots, noticesDue, pickBy, sessionState } from "../../src/lib/organizations/lab-reading-group";

// Report 35.4 (B6.4b): weekly slots in the lab's zone, a rotation that skips Away, pick-by and notices.
test("slots: every Tuesday 16:00 in Kolkata from a Wednesday", () => {
  assert.deepEqual(nextSlots(2, "16:00", "Asia/Kolkata", new Date("2026-11-25T12:00:00Z"), 2), ["2026-12-01T10:30:00.000Z", "2026-12-08T10:30:00.000Z"]);
  assert.deepEqual(nextSlots(2, "16:00", "Asia/Kolkata", new Date("2026-12-01T10:00:00Z"), 1), ["2026-12-01T10:30:00.000Z"], "today's slot when it's still ahead");
});

test("rotation: after the last presenter, skipping anyone Away; nobody when all are", () => {
  const order = ["ravi", "meera", "arjun"];
  assert.equal(nextPresenter(order, "ravi", () => false), "meera");
  assert.equal(nextPresenter(order, "arjun", () => false), "ravi");
  assert.equal(nextPresenter(order, "ravi", (id) => id === "meera"), "arjun");
  assert.equal(nextPresenter(order, null, () => false), "ravi");
  assert.equal(nextPresenter(order, "gone", () => false), "ravi");
  assert.equal(nextPresenter(order, "ravi", () => true), null);
});

test("pick by, states and notices", () => {
  const s = { startsAt: "2026-12-08T10:30:00.000Z", sourceId: null, nextNoticeAt: null, pickNoticeAt: null, lateNoticeAt: null };
  assert.equal(pickBy(s.startsAt, 3), "2026-12-05T10:30:00.000Z");
  assert.equal(sessionState({ doneAt: null, sourceId: null }), "waiting");
  assert.equal(sessionState({ doneAt: null, sourceId: "x" }), "picked");
  assert.deepEqual(noticesDue(s, 3, new Date("2026-11-30T10:00:00Z")), { next: false, pickTomorrow: false, late: false });
  assert.deepEqual(noticesDue(s, 3, new Date("2026-12-04T11:00:00Z")), { next: true, pickTomorrow: true, late: false });
  assert.deepEqual(noticesDue(s, 3, new Date("2026-12-06T00:00:00Z")), { next: true, pickTomorrow: false, late: true });
  assert.deepEqual(noticesDue({ ...s, sourceId: "x", nextNoticeAt: "t" }, 3, new Date("2026-12-06T00:00:00Z")), { next: false, pickTomorrow: false, late: false });
});
