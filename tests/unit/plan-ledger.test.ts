import assert from "node:assert/strict";
import { test } from "node:test";

import { check, extractItems, milestoneFor, sync, type Ledger } from "../../scripts/plan/report-items";

// Report Part 0.9: every report item has a ledger row with a test, and a closed milestone has nothing left open.
const report = `# Part 0: rules
**0.1 How work is done**
- Building starts only on "implement".
**0.8 Everyday polish**
| # | Item | Milestone |
|---|---|---|
| 1 | Empty states everywhere | M1, M5 |

# Part A: sign-in
## A1. What's there today
- The form needs one workspace.
## A2. The page
- One click: Approve.
1. Pre-fills what the CLI asked for.

# Registers
**R1. Migrations**
| # | Part | What |
|---|---|---|
| 0082 | A | country |

# Review log
- Not an item.
`;

test("items come from bullets, numbered steps and table rows, with kinds and stable keys", () => {
  const items = extractItems(report);
  assert.deepEqual(items.map((i) => [i.section, i.kind]), [["0.1", "rule"], ["0.8", "build"], ["A1", "fact"], ["A2", "build"], ["A2", "build"], ["R1", "register"]]);
  assert.equal(extractItems(report)[3]!.key, items[3]!.key, "same text, same key");
  assert.ok(!items.some((i) => i.text.includes("Not an item")), "the review log is not tracked");
});

test("polish rows close with their last milestone; sections map by part", () => {
  assert.equal(milestoneFor("0.8", "1 · Empty states everywhere · M1, M5"), "M5");
  assert.equal(milestoneFor("0.8", "7 · Confirm dialogs · each milestone"), "M9");
  assert.deepEqual(["A2", "B", "C3", "D23", "E1", "E9", "F4", "F7", "G10", "G14", "H24"].map((s) => milestoneFor(s)), ["M1", "M2", "M4", "M4", "M3", "M9", "M6", "M1", "M5", "M6", "M8"]);
});

test("check: missing rows, untested finished rows, open rows in a closed milestone, and orphans all fail", () => {
  const items = extractItems(report);
  const empty: Ledger = { report: "", closedMilestones: [], rows: [] };
  assert.ok(check(items, empty).some((p) => p.startsWith("no ledger row")));

  const synced = sync(items, empty);
  assert.deepEqual(check(items, synced), []);

  const built = { ...synced, rows: synced.rows.map((r) => (r.section === "A2" ? { ...r, status: "built" as const } : r)) };
  assert.ok(check(items, built).some((p) => p.includes("names no test")));

  const closed = { ...synced, closedMilestones: ["M1"] };
  assert.ok(check(items, closed).some((p) => p.includes("closed milestone M1")));

  const changed = extractItems(report.replace("One click: Approve.", "One click: Approve now."));
  assert.deepEqual(check(changed, sync(changed, synced)), [], "a changed item with no evidence just moves to its new key");
  const withEvidence = { ...synced, rows: synced.rows.map((r) => (r.text === "One click: Approve." ? { ...r, status: "tested" as const, test: "tests/x.test.ts" } : r)) };
  assert.ok(check(changed, sync(changed, withEvidence)).some((p) => p.startsWith("orphan row")), "evidence is never dropped silently");
});
