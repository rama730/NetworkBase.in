import assert from "node:assert/strict";
import { test } from "node:test";

import { matrixBox, matrixMove, matrixOrder, pushedPast, urgentChoices } from "../../src/lib/workflows/planner";

// Report 38.5 T1 part 7 (matrixBox) and 11.7 parts 4–5 (plan A1.2).
const today = "2026-11-20";
const t = (priority: string, due: string | null, status = "todo", itemType?: string) => ({ priority, dueDate: due ? `${due}T00:00:00.000Z` : null, status, itemType });

test("matrixBox: the report's cases", () => {
  assert.equal(matrixBox(t("high", "2026-11-21"), today), "do", "High due tomorrow");
  assert.equal(matrixBox(t("urgent", null), today), "schedule", "Urgent with no date");
  assert.equal(matrixBox(t("low", "2026-11-10"), today), "delegate", "Low overdue");
  assert.equal(matrixBox(t("medium", "2026-12-04"), today), "drop", "Medium in 2 weeks");
  assert.equal(matrixBox(t("high", "2026-11-23"), today), "do", "the third day is still urgent");
  assert.equal(matrixBox(t("high", "2026-11-24"), today), "schedule");
  assert.equal(matrixBox(t("high", "2026-11-21", "done"), today), null, "completed: none");
  assert.equal(matrixBox(t("high", "2026-11-21", "todo", "project"), today), null, "projects sit in no box");
});

test("matrixMove: rows change priority, columns ask for a date", () => {
  assert.deepEqual(matrixMove("drop", "schedule"), { priority: "high", due: null });
  assert.deepEqual(matrixMove("do", "delegate"), { priority: "medium", due: null });
  assert.deepEqual(matrixMove("schedule", "do"), { priority: null, due: "pick" });
  assert.deepEqual(matrixMove("do", "schedule"), { priority: null, due: "clear-or-push" });
  assert.deepEqual(matrixMove("drop", "do"), { priority: "high", due: "pick" });
});

test("order: soonest first, no date last, then priority; quick dates and push", () => {
  const order = matrixOrder([t("high", null), t("urgent", "2026-11-22"), t("high", "2026-11-21"), t("urgent", "2026-11-21")]);
  assert.deepEqual(order.map((x) => [x.priority, x.dueDate?.slice(0, 10) ?? null]), [["urgent", "2026-11-21"], ["high", "2026-11-21"], ["urgent", "2026-11-22"], ["high", null]]);
  assert.deepEqual(urgentChoices(today).map((c) => c.key), ["2026-11-20", "2026-11-21", "2026-11-23"]);
  assert.equal(pushedPast(today), "2026-11-27");
});
