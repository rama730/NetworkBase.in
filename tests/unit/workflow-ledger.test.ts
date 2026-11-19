import assert from "node:assert/strict";
import { test } from "node:test";

import { extractReportItems, extractUnits, milestoneOf, problems, sync, type Row } from "../../scripts/plan/workflow-ledger";

test("units come from bold ids, table rows and ranges", () => {
  const plan = ["**A0.1 Types and stages engine** (38.2)", "| A3.2 | Product launch | Market research |", "**B8.4 X1 Start from a kit** + **B8.5–B8.7 one kit each**"].join("\n");
  assert.deepEqual(extractUnits(plan).map((u) => u.key).sort(), ["A0.1", "A3.2", "B8.4", "B8.5", "B8.6", "B8.7"]);
});

test("walkthroughs and calls come from the report sections", () => {
  const report = [
    "### 38.2 F1 · Types",
    "**W1 · An admin adds Bugs (desktop, first time)**",
    "1. Not a call",
    "#### 11. Calls",
    "1. Types live on the task row. **[call]**",
    "2. Stage names are fixed.",
    "**Next:** F2",
    "### 30.3 W2 · Term plan",
    "**W1 · not a 38 walkthrough**",
    "**Calls agreed 2026-11-17:**",
    "1. Lessons never on the board.",
  ].join("\n");
  assert.deepEqual(extractReportItems(report).map((i) => i.key), ["38.2.W1", "38.2.call1", "38.2.call2", "30.3.call1"]);
});

test("milestones map report sections to plan waves", () => {
  assert.equal(milestoneOf("38.2"), "A0");
  assert.equal(milestoneOf("38.11"), "A4");
  assert.equal(milestoneOf("38.18"), "A7");
  assert.equal(milestoneOf("30.3"), "B1");
  assert.equal(milestoneOf("37.2"), "B8");
});

test("sync adds new rows and marks vanished ones; check names problems", () => {
  const old: Row = { key: "A0.9", section: "plan", text: "gone", kind: "unit", milestone: "A0", status: "todo", test: "", evidence: "" };
  const rows = sync([old], [{ key: "A0.1", section: "plan", text: "t", kind: "unit", milestone: "A0" }]);
  assert.equal(rows.find((r) => r.key === "A0.1")?.status, "todo");
  assert.equal(rows.find((r) => r.key === "A0.9")?.orphan, true);
  const live: Row = { ...rows[1]!, status: "live", test: "" };
  const pending: Row = { ...rows[1]!, key: "A0.2", status: "live-pending", test: "t", evidence: "hourly breach" };
  const found = problems([live, pending], [{ key: "A0.1", section: "plan", text: "t", kind: "unit", milestone: "A0" }]);
  assert.ok(found.includes("row A0.1 is live without a test"));
  assert.ok(found.some((p) => p.startsWith("row A0.2 is live-pending without")));
});
