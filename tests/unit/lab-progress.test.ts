import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LAB } from "../../src/lib/organizations/lab";
import { addMonths, milestoneNotices, milestonePlan, supervisionRhythm } from "../../src/lib/organizations/lab-progress";

// Report 35.6 (B6.5b): milestones from the start date, part-time doubled; the supervision rhythm; notices.
test("months: month ends hold", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2024-09-01", 12), "2025-09-01");
});

test("a PhD plan from a start date; part-time doubles the months", () => {
  const plan = milestonePlan(DEFAULT_LAB.milestones.phd!, "2024-09-01", false);
  assert.deepEqual(plan.map((p) => `${p.name} ${p.dueOn}`), ["Proposal 2025-09-01", "Annual review 1 2025-09-01", "Qualifying exam 2026-03-01", "Annual review 2 2026-09-01",
    "Annual review 3 2027-09-01", "Thesis submission 2028-03-01", "Annual review 4 2028-09-01", "Defence 2028-09-01"]);
  assert.equal(milestonePlan(DEFAULT_LAB.milestones.masters!, "2024-09-01", true).find((p) => p.key === "submission")!.dueOn, "2028-05-01");
});

test("supervision rhythm and milestone notices", () => {
  assert.deepEqual(supervisionRhythm("2026-11-01", "2024-09-01", 2, "2026-11-20"), { next: "2026-11-15", overdue: false });
  assert.deepEqual(supervisionRhythm("2026-11-01", "2024-09-01", 2, "2026-11-23"), { next: "2026-11-15", overdue: true });
  assert.deepEqual(supervisionRhythm(null, "2026-11-01", 2, "2026-11-10"), { next: "2026-11-15", overdue: false });
  const m = { dueOn: "2026-12-20", state: "upcoming" as const, notice30At: null, notice7At: null };
  assert.deepEqual(milestoneNotices(m, "2026-11-25"), { d30: true, d7: false });
  assert.deepEqual(milestoneNotices(m, "2026-12-15"), { d30: false, d7: true }, "inside 7 days only the 7-day notice");
  assert.deepEqual(milestoneNotices({ ...m, state: "done" }, "2026-12-15"), { d30: false, d7: false });
});
