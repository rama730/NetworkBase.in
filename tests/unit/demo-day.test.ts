import assert from "node:assert/strict";
import test from "node:test";

import { advance, awardPicks, readDemoDay, runOfShow } from "@/lib/organizations/demo-day";

const A = "6b1d0c2e-1111-4a1a-9a1a-0a1b2c3d4e5f", B = "6b1d0c2e-2222-4a1a-9a1a-0a1b2c3d4e5f", C = "6b1d0c2e-3333-4a1a-9a1a-0a1b2c3d4e5f";

test("demo day defaults: two awards to pick, nothing announced", () => {
  const d = readDemoDay(null);
  assert.deepEqual([d.date, d.start, d.pitch, d.questions, d.awards, d.current], [null, "15:00", 5, 3, ["Best project", "Mentors’ pick"], -1]);
});

test("the run of show keeps the set order, adds new teams at the end, drops gone ones, and times each slot", () => {
  const r = runOfShow({ order: [B, "6b1d0c2e-9999-4a1a-9a1a-0a1b2c3d4e5f", A], start: "15:00", pitch: 5, questions: 3 }, [{ id: A, title: "Kite" }, { id: B, title: "Lumen" }, { id: C, title: "Orbit" }]);
  assert.deepEqual(r.map((s) => [s.title, s.at]), [["Lumen", "15:10"], ["Kite", "15:18"], ["Orbit", "15:26"]]);
  assert.equal(advance(-1, 3), 0);
  assert.equal(advance(3, 3), 3);
});

test("award picks are grouped per award for staff to announce; no totals across awards", () => {
  const r = awardPicks([{ award: "Best project", teamId: A }, { award: "Best project", teamId: A }, { award: "Best project", teamId: B }, { award: "Mentors’ pick", teamId: B }], ["Best project", "Mentors’ pick"]);
  assert.deepEqual(r, [{ award: "Best project", picks: [{ teamId: A, n: 2 }, { teamId: B, n: 1 }] }, { award: "Mentors’ pick", picks: [{ teamId: B, n: 1 }] }]);
});
