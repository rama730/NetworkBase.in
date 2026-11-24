import assert from "node:assert/strict";
import { test } from "node:test";

import { templateById } from "../../src/lib/workflows/doc-templates";
import { assumptionRows, bmcBoxes, parseTable, prdParts, reviewState, templateOfDoc, testPlanSummary } from "../../src/lib/workflows/template-extras";

test("A6.36: which template a document came from", () => {
  assert.equal(templateOfDoc({ kind: "test-plan", filename: "x.md" }), "test-plan");
  assert.equal(templateOfDoc({ filename: "Tech spec – WT Sign-in.md" }), "tech-spec");
  assert.equal(templateOfDoc({ filename: "PRD.md" }), "prd");
  assert.equal(templateOfDoc({ kind: "weekly", filename: "Notes.md" }), null);
});

test("call 4: test plan counts and pass rate, unknown results count as Not run", () => {
  const md = `x\n\n| Case | Steps | Expected | Result | Tester | Date |\n|---|---|---|---|---|---|\n| A | s1 | e1 | Pass | | |\n| B | s2 | e2 | **Fail** | | |\n| C | | | Blocked | | |\n| D | | | maybe | | |\n|  |  |  |  |  |  |\n`;
  const s = testPlanSummary(md);
  assert.deepEqual([s.pass, s.fail, s.blocked, s.notRun, s.total, s.rate], [1, 1, 1, 1, 4, 33]);
  assert.deepEqual(s.failing, [{ case: "B", steps: "s2", expected: "e2" }]);
  assert.equal(testPlanSummary(templateById("test-plan")!.body).rate, null);
});

test("11.8: load-bearing and broken assumptions", () => {
  const md = `| Assumption | Depends on | Evidence | If it’s wrong, what breaks | Cheapest test | Status |\n|---|---|---|---|---|---|\n| Teachers want it | | Weak | All | Ask 5 | Broken |\n| Schools will pay | Teachers want it | Weak | Pricing | 5 calls | Testing |\n|  |  |  |  |  | Untested |\n`;
  const rows = assumptionRows(md);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.assumption, r.loadBearing, r.broken]), [["Teachers want it", true, true], ["Schools will pay", false, false]]);
});

test("20.2: Must requirements and real user stories", () => {
  const md = `## Requirements\n| Requirement | Priority (Must / Should / Could) | Roadmap item |\n|---|---|---|\n| SSO | Must | |\n| Dark mode | Could | |\n\n## User stories\n- As a … I want … so that …\n- As a teacher I want SSO so that I sign in once\n\n## MVP scope\n- not a story\n`;
  assert.deepEqual(prdParts(md), { must: ["SSO"], stories: ["As a teacher I want SSO so that I sign in once"] });
  assert.deepEqual(prdParts(templateById("prd")!.body), { must: [], stories: [] });
  assert.deepEqual(parseTable("## Other\n", "Requirements"), { header: [], rows: [] });
});

test("call 3: nine canvas boxes in order; review state", () => {
  const boxes = bmcBoxes(templateById("business-model-canvas")!.body);
  assert.equal(boxes.length, 9);
  assert.match(boxes[3]!.body, /Offering/);
  assert.deepEqual(reviewState([]), { state: "draft", done: 0, total: 0 });
  assert.deepEqual(reviewState([{ done: true }, { done: false }]), { state: "in_review", done: 1, total: 2 });
  assert.equal(reviewState([{ done: true }]).state, "approved");
});
