import { it } from "node:test";
import assert from "node:assert/strict";
import { parseDate } from "../lib/dates.mjs";

// Report C2: natural dates. Wednesday 11 Nov 2026 as "now".
const wed = new Date(2026, 10, 11, 15, 0);

it("reads the words people type for a due date", () => {
  const cases = { today: "2026-11-11", tomorrow: "2026-11-12", friday: "2026-11-13", fri: "2026-11-13", wednesday: "2026-11-18", "this wednesday": "2026-11-11",
    "next friday": "2026-11-20", "next week": "2026-11-16", "in 3 days": "2026-11-14", "in 2 weeks": "2026-11-25", "2026-12-01": "2026-12-01", "  Tomorrow ": "2026-11-12" };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseDate(text, wed), want, text);
});

it("says null for what isn't a date", () => {
  for (const text of ["", "soon", "2026-02-30", "in 1000 days", "fridayy"]) assert.equal(parseDate(text, wed), null, text);
});
