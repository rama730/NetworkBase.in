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

it("parseWhen: reminder times in the person's own day (C2)", async () => {
  const { parseWhen } = await import("../lib/dates.mjs");
  const now = new Date(2026, 10, 12, 15, 30); // Thu 12 Nov, 15:30
  const at = (/** @type {string} */ t) => { const d = parseWhen(t, now); return d && `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  assert.equal(at("tomorrow 9am"), "13 9:00");
  assert.equal(at("friday 14:30"), "13 14:30");
  assert.equal(at("today 5pm"), "12 17:00");
  assert.equal(at("tomorrow at 12am"), "13 0:00");
  assert.equal(at("next week"), "16 9:00", "a date alone is 9:00 that day");
  assert.equal(at("in 2 hours"), "12 17:30");
  assert.equal(at("in 30 minutes"), "12 16:00");
  assert.equal(at("25pm"), null);
  assert.equal(at("someday"), null);
  assert.equal(at("7"), null, "a bare number isn't a time");
});
