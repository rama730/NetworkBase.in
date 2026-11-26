import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LAB, groupByPosition, readLabSettings, readPosition } from "../../src/lib/organizations/lab";

test("35.2 call 2: people group by the lab's positions in order; no position comes last as Members", () => {
  const people = [{ id: "a", position: "phd" }, { id: "b", position: null }, { id: "c", position: "pi" }, { id: "d", position: "gone" }];
  const g = groupByPosition(people, DEFAULT_LAB.positions);
  assert.deepEqual(g.map((x) => [x.label, x.people.map((p) => p.id)]), [["PI", ["c"]], ["PhD student", ["a"]], ["Members", ["b", "d"]]]);
});

test("lab settings fall back to defaults; positions read tolerantly from view_prefs", () => {
  assert.deepEqual(readLabSettings(null), DEFAULT_LAB);
  assert.deepEqual(readLabSettings({ lab: { officeHours: "Thu 15:00" } }).officeHours, "Thu 15:00");
  assert.deepEqual(readLabSettings({ lab: { positions: [] } }), DEFAULT_LAB, "an invalid save never breaks the lab");
  assert.deepEqual(readPosition({ lab: { position: "phd", startYear: 2024, alumni: { listed: true } } }), { position: "phd", startYear: 2024 });
  assert.deepEqual(readPosition(null), { position: null, startYear: null });
});
