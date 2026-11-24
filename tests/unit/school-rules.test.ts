import assert from "node:assert/strict";
import test from "node:test";

import { attentionReasons, classCounts } from "../../src/lib/organizations/school-rules";

// Report 29.2 B0.2: what a school sees of a class, and when a class needs attention.
const base = { id: "c", title: "Maths", slug: null, teacher: "Asha", department: null, termStart: null, termEnd: null, counted: true, members: 30, openAssignments: 2, toReview: 3, lastActivity: "2026-11-20T10:00:00Z", behindPlan: 0 };
const now = Date.parse("2026-11-24T10:00:00Z");

test("a moving class needs nothing; 10+ to review or 14 quiet days need attention; uncounted classes never show", () => {
  assert.deepEqual(attentionReasons(base, now), []);
  assert.deepEqual(attentionReasons({ ...base, toReview: 10 }, now), ["10 hand-ins waiting for review"]);
  assert.deepEqual(attentionReasons({ ...base, behindPlan: 2 }, now), ["2 lessons behind plan"], "B1.2b Behind plan");
  assert.deepEqual(attentionReasons({ ...base, behindPlan: 1 }, now), []);
  assert.deepEqual(attentionReasons({ ...base, lastActivity: "2026-11-09T10:00:00Z" }, now), ["No activity for 14 days"]);
  assert.deepEqual(attentionReasons({ ...base, lastActivity: null }, now), ["No activity for 14 days"]);
  assert.deepEqual(attentionReasons({ ...base, counted: false, toReview: 0, lastActivity: null }, now), []);
  assert.equal(classCounts(base), "30 members · 2 open assignments · 3 to review · active Nov 20");
  assert.equal(classCounts({ ...base, members: 1, openAssignments: 1, lastActivity: null }), "1 member · 1 open assignment · 3 to review", "found live: 1 members");
});
