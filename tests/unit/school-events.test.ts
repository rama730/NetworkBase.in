import assert from "node:assert/strict";
import test from "node:test";

import { eventFieldsSchema, forMe, occurrences } from "@/lib/organizations/school-events";
import { schoolYearSchema } from "@/lib/organizations/school-year";

const year = schoolYearSchema.parse({ name: "2026–27", terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-12-18" }],
  days: [{ name: "Half-term", kind: "holiday", start: "2026-10-26", end: "2026-10-30" }, { name: "INSET", kind: "staff", start: "2026-10-05", end: "2026-10-05" }] });
const A = "6b1d0c2e-1111-4a1a-9a1a-0a1b2c3d4e5f";

test("a weekly repeat skips holidays and staff days; a one-off shows on its day", () => {
  const briefing = eventFieldsSchema.parse({ date: "2026-09-28", repeat: { every: 1, until: "2026-11-09" } });
  assert.deepEqual(occurrences(briefing, "2026-09-01", "2026-12-31", year), ["2026-09-28", "2026-10-12", "2026-10-19", "2026-11-02", "2026-11-09"]);
  assert.deepEqual(occurrences(briefing, "2026-10-15", "2026-10-31", year), ["2026-10-19"]);
  const once = eventFieldsSchema.parse({ date: "2026-10-07" });
  assert.deepEqual(occurrences(once, "2026-10-01", "2026-10-31", year), ["2026-10-07"]);
  assert.deepEqual(occurrences(once, "2026-11-01", "2026-11-30", year), []);
});

test("For me: everyone, my class, or my role", () => {
  const me = { classIds: [A], role: "member" as const };
  assert.equal(forMe({ mode: "everyone", classIds: [], roles: [] }, me), true);
  assert.equal(forMe({ mode: "classes", classIds: [A], roles: [] }, me), true);
  assert.equal(forMe({ mode: "classes", classIds: [], roles: [] }, me), false);
  assert.equal(forMe({ mode: "roles", classIds: [], roles: ["admin"] }, me), false);
  assert.equal(forMe({ mode: "roles", classIds: [], roles: ["admin"] }, { classIds: [], role: "owner" }), true);
  assert.equal(forMe({ mode: "roles", classIds: [], roles: ["member"] }, { classIds: [], role: "viewer" }), false);
});
