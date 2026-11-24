import assert from "node:assert/strict";
import { test } from "node:test";

import { cohortEnd, cohortState, weeksBetween } from "../../src/lib/organizations/programs";

// Plan B2.1a (report 31.2 C1).
test("cohort states by day; the end from the length; the length from a term", () => {
  assert.deepEqual([cohortState("2027-04-21", "2027-07-13", "2027-04-20"), cohortState("2027-04-21", "2027-07-13", "2027-04-21"), cohortState("2027-04-21", "2027-07-13", "2027-07-14")], ["upcoming", "running", "finished"]);
  assert.equal(cohortState(null, null, "2027-01-01"), "running");
  assert.equal(cohortEnd("2027-04-21", 12), "2027-07-13");
  assert.deepEqual([weeksBetween("2027-04-21", "2027-07-13"), weeksBetween("2027-04-21", "2027-04-21"), weeksBetween(null, "2027-01-01"), weeksBetween("2027-02-01", "2027-01-01")], [12, 1, null, null]);
});
