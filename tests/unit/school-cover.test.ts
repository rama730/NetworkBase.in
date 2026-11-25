import assert from "node:assert/strict";
import test from "node:test";

import { absentPeriods, coverSlots, suggestions } from "@/lib/organizations/school-cover";

const order = ["P1", "P2", "P3", "P4"];
const slot = (id: string, period: string, teacherId: string) => ({ id, day: 2, period, week: null, className: id, courseId: null, teacherId, room: null });

test("an absence by day or by periods opens the absent teacher's slots in it", () => {
  assert.deepEqual(absentPeriods(order, { userId: "a", from: null, to: null }), order);
  assert.deepEqual(absentPeriods(order, { userId: "a", from: "P2", to: "P3" }), ["P2", "P3"]);
  const open = coverSlots([slot("6A", "P1", "a"), slot("6B", "P3", "a"), slot("7A", "P3", "b")], order, [{ userId: "a", from: "P2", to: "P4" }]);
  assert.deepEqual(open.map((s) => s.id), ["6B"]);
});

test("suggestions: free that period, then same department, then fewest covers; reasons in words", () => {
  const staff = [{ userId: "b", name: "Ben", department: "sci" }, { userId: "c", name: "Cy", department: "eng" }, { userId: "d", name: "Di", department: "sci" }, { userId: "e", name: "Ed", department: "sci" }];
  const s = suggestions(slot("6B", "P3", "a"), "P3", staff, new Set(["e"]), new Set(), new Set(), new Map([["b", 4], ["d", 1]]), "sci");
  assert.deepEqual(s.map((x) => [x.name, x.reason]), [["Di", "free P3, same department, 1 cover this term"], ["Ben", "free P3, same department, 4 covers this term"], ["Cy", "free P3, 0 covers this term"]]);
});
