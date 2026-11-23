import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewRequest, loadedCount, searchMatchLine, suggestionReason } from "../../src/lib/network/mix";

test("a suggestion shows its reason unless the reason only repeats the mutual count or says nothing", () => {
  assert.equal(suggestionReason("Matches your open role: Designer"), "Matches your open role: Designer");
  assert.equal(suggestionReason("  Also in CSE 3B  "), "Also in CSE 3B");
  assert.equal(suggestionReason("4 mutual connections"), null);
  assert.equal(suggestionReason("1 mutual connection"), null);
  assert.equal(suggestionReason("Suggested for your network"), null);
  assert.equal(suggestionReason(""), null);
  assert.equal(suggestionReason(null), null);
  assert.equal(suggestionReason(undefined), null);
});

test("a request is new for its first 24 hours", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(isNewRequest("2026-11-23T09:00:00Z", now), true);
  assert.equal(isNewRequest(new Date("2026-11-22T12:00:01Z"), now), true);
  assert.equal(isNewRequest("2026-11-22T11:59:59Z", now), false);
  assert.equal(isNewRequest("2026-11-24T00:00:00Z", now), false, "a clock-skewed future date is not new");
  assert.equal(isNewRequest(null, now), false);
  assert.equal(isNewRequest("not a date", now), false);
});

test("loaded counts pad to two digits and say when more pages exist", () => {
  assert.equal(loadedCount(6, false), "06");
  assert.equal(loadedCount(20, true), "20+");
  assert.equal(loadedCount(0, false), "00");
  assert.equal(loadedCount(120, false), "120");
});

test("the search line says how many match, out of the total when the total is known", () => {
  assert.equal(searchMatchLine(2, false, "py"), "02 match “py”");
  assert.equal(searchMatchLine(20, true, "react"), "20+ match “react”");
  assert.equal(searchMatchLine(2, false, "ben", 3), "02 of 03 match “ben”");
});
