import assert from "node:assert/strict";
import test from "node:test";

import { readSectionSettings, reviewLoadWarnings, seatsLeft, splitStudents } from "../../src/lib/organizations/sections";

// Report 30.9 W8 (plan B1.3): Split students, seats, review load and settings.
const students = ["Asha Rao", "Ben Kim", "Chitra Iyer", "Dev Patel", "Esha Shah", "Farid Ali", "Gita Bose"].map((name, i) => ({ id: `u${i}`, name }));
const sections = [{ id: "A", name: "A", seatLimit: null }, { id: "B", name: "B", seatLimit: null }, { id: "C", name: "C", seatLimit: null }];
const sizes = (placed: Array<{ sectionId: string }>) => ["A", "B", "C"].map((id) => placed.filter((p) => p.sectionId === id).length);

test("even split differs by at most one; random is stable for a seed; surname keeps blocks in surname order", () => {
  const even = splitStudents(students, sections, "even");
  assert.deepEqual(sizes(even.placed), [3, 2, 2]);
  assert.deepEqual(even.unplaced, []);
  assert.deepEqual(splitStudents(students, sections, "random", "s1"), splitStudents(students, sections, "random", "s1"));
  const bySurname = splitStudents(students, sections, "surname");
  assert.deepEqual(bySurname.placed.slice(0, 3).map((p) => students.find((s) => s.id === p.userId)!.name), ["Farid Ali", "Gita Bose", "Chitra Iyer"]);
});

test("seat limits stop placing; leftovers stay unplaced; no sections places nobody", () => {
  const limited = splitStudents(students, [{ id: "A", name: "A", seatLimit: 2 }, { id: "B", name: "B", seatLimit: 2 }], "even");
  assert.deepEqual([limited.placed.length, limited.unplaced.length], [4, 3]);
  assert.deepEqual(splitStudents(students, [], "even").unplaced.length, 7);
  assert.equal(seatsLeft(10, 12), 0);
  assert.equal(seatsLeft(null, 12), null);
});

test("call 9: a TA above 1.5× the average review load is flagged; settings default to Section, own section only, no self-pick", () => {
  assert.deepEqual([...reviewLoadWarnings([{ userId: "p", toReview: 12 }, { userId: "a", toReview: 3 }, { userId: "m", toReview: 20 }])], ["m"]);
  assert.equal(reviewLoadWarnings([{ userId: "p", toReview: 9 }]).size, 0);
  assert.deepEqual(readSectionSettings({}), { word: "Section", taOnlyOwn: true, selfPick: false });
  assert.deepEqual(readSectionSettings({ sections: { word: "Batch", taOnlyOwn: false, selfPick: true } }), { word: "Batch", taOnlyOwn: false, selfPick: true });
});
