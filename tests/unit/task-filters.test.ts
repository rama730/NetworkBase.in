import assert from "node:assert/strict";
import { test } from "node:test";

import { chipValue, EMPTY_FILTERS, filtersFromUrl, filtersToUrl, matchesFilters, setCount } from "../../src/lib/workspaces/task-filters";

// Report 38.4 F3 part 7 (filtersFromUrl / filtersToUrl) and S5, W7 (plan A0.11).
const ME = "7a0c1c34-1c7b-4b56-9d55-5f1f1d7c2a10";
test("URL round trip; unknown keys and values dropped", () => {
  const f = filtersFromUrl(new URLSearchParams("assignee=me,none&type=bug&due=week&priority=high,nope&taskSprint=none&sprint=x&color=red"));
  assert.deepEqual(f, { assignee: ["me", "none"], type: ["bug"], due: "week", priority: ["high"], sprint: ["none"] });
  assert.deepEqual(filtersFromUrl(new URLSearchParams(Object.entries(filtersToUrl(f)).filter(([, v]) => v) as [string, string][])), f);
  assert.deepEqual(filtersToUrl(EMPTY_FILTERS), { assignee: null, type: null, due: null, priority: null, taskSprint: null });
  assert.equal(filtersFromUrl(new URLSearchParams("due=someday")).due, null);
});

test("matchesFilters: me resolves to the viewer; type defaults to task; due by calendar day", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const t = (x: object) => ({ assigneeId: ME, itemType: undefined, dueDate: null, status: "todo", priority: "medium", sprintId: null, ...x });
  const f = (x: object) => ({ ...EMPTY_FILTERS, ...x });
  assert.equal(matchesFilters(t({}), f({ assignee: ["me"] }), ME, now), true);
  assert.equal(matchesFilters(t({ assigneeId: null }), f({ assignee: ["me"] }), ME, now), false);
  assert.equal(matchesFilters(t({ assigneeId: null }), f({ assignee: ["none"] }), ME, now), true);
  assert.equal(matchesFilters(t({}), f({ type: ["task"] }), ME, now), true);
  assert.equal(matchesFilters(t({ itemType: "bug" }), f({ type: ["task"] }), ME, now), false);
  assert.equal(matchesFilters(t({ dueDate: "2026-11-19T00:00:00Z" }), f({ due: "overdue" }), ME, now, "UTC"), true);
  assert.equal(matchesFilters(t({ dueDate: "2026-11-19T00:00:00Z", status: "done" }), f({ due: "overdue" }), ME, now, "UTC"), false);
  assert.equal(matchesFilters(t({ dueDate: "2026-11-20T23:00:00Z" }), f({ due: "today" }), ME, now, "UTC"), true);
  assert.equal(matchesFilters(t({ dueDate: "2026-11-26T00:00:00Z" }), f({ due: "week" }), ME, now, "UTC"), true);
  assert.equal(matchesFilters(t({ dueDate: "2026-11-28T00:00:00Z" }), f({ due: "week" }), ME, now, "UTC"), false);
  assert.equal(matchesFilters(t({}), f({ due: "none" }), ME, now), true);
  assert.equal(matchesFilters(t({ priority: "high" }), f({ priority: ["high", "urgent"] }), ME, now), true);
});

test("chip text and Clear all count", () => {
  assert.equal(chipValue(["Me", "Asha", "Mei"]), "Me +2");
  assert.equal(chipValue([]), null);
  assert.equal(setCount({ ...EMPTY_FILTERS, assignee: ["me"], due: "today" }), 2);
});
