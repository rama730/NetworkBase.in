import assert from "node:assert/strict";
import test from "node:test";

import { cohortBars, kindStartingValues, readSchoolKind } from "@/lib/organizations/school-kind";

test("only Coaching or bootcamp sets starting values; unknown kinds read as none", () => {
  assert.deepEqual(kindStartingValues("coaching"), { roleNames: { owner: "Instructor", admin: "Mentor", member: "Learner" }, mainSprintWord: "Module", joinMode: "approval" });
  assert.deepEqual(kindStartingValues("college"), {});
  assert.deepEqual(kindStartingValues(null), {});
  assert.equal(readSchoolKind({ schoolKind: "coaching" }), "coaching");
  assert.equal(readSchoolKind({ schoolKind: "camp" }), null);
  assert.equal(readSchoolKind(null), null);
});

test("cohort bars share one range; undated cohorts get no bar", () => {
  const r = cohortBars([
    { id: "a", start: "2027-01-01", end: "2027-01-10" },
    { id: "b", start: "2027-01-11", end: "2027-01-20" },
    { id: "c", start: null, end: null },
  ]);
  assert.equal(r.start, "2027-01-01");
  assert.equal(r.end, "2027-01-20");
  assert.deepEqual(r.bars.map((b) => [b.id, b.left, b.width]), [["a", 0, 50], ["b", 50, 50]]);
  assert.deepEqual(cohortBars([{ start: null, end: null }]).bars, []);
});
