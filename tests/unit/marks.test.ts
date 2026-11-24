import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LEVELS, markText, markTotal, readMarking, readRubrics, rubricOutOf, type Rubric } from "../../src/lib/organizations/marks";

// Report 30.8 W7 (plan B1.5): marking modes, rubric totals, the result line.
const rubric: Rubric = { id: "r1", name: "Lab rubric", criteria: ["Correctness", "Code quality", "Report"].map((name, i) => ({ id: `c${i}`, name, levels: DEFAULT_LEVELS })) };

test("a rubric totals its picked levels and needs every criterion; Out of takes 0..N; Not marked takes nothing", () => {
  assert.equal(rubricOutOf(rubric), 30);
  assert.deepEqual(markTotal({ mode: "rubric", rubric }, { levels: { c0: 0, c1: 1, c2: 2 } }), { total: 21, outOf: 30 });
  assert.deepEqual(markTotal({ mode: "rubric", rubric }, { levels: { c0: 0 } }), { error: "Pick a level for Code quality." });
  assert.deepEqual(markTotal({ mode: "outof", outOf: 50 }, { total: 38 }), { total: 38, outOf: 50 });
  assert.ok("error" in markTotal({ mode: "outof", outOf: 50 }, { total: 51 }));
  assert.ok("error" in markTotal({ mode: "none" }, {}));
  assert.equal(markText(21, 30), "21 / 30 · 70%");
});

test("stored marking and rubrics are read defensively", () => {
  assert.deepEqual(readMarking({}), { mode: "none" });
  assert.deepEqual(readMarking({ marking: { mode: "outof", outOf: 50 } }), { mode: "outof", outOf: 50 });
  assert.deepEqual(readMarking({ marking: { mode: "rubric", rubric } }).mode, "rubric");
  assert.deepEqual(readMarking({ marking: { mode: "rubric", rubric: { id: "x", name: "Empty", criteria: [] } } }), { mode: "none" }, "an empty rubric marks nothing");
  assert.deepEqual(readRubrics({ rubrics: [rubric, { nope: 1 }] }).map((r) => r.name), ["Lab rubric"]);
});
