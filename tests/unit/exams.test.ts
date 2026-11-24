import assert from "node:assert/strict";
import { test } from "node:test";

import { closeFor, examPhase, examStateText, needsAgreement, overlaps, paperLocked, readExam, resultsHeld } from "../../src/lib/organizations/exams";

// Plan B1.6 (report 30.5 W4).
const base = { format: "timed", opensAt: "2027-02-26T10:00:00Z", closesAt: "2027-02-26T12:00:00Z", room: " LH-2 · 204 ", covers: { units: ["u1"], outcomes: ["CO1"] } };
const fmt = (d: Date) => d.toISOString().slice(11, 16);

test("readExam: valid windows only; hold is on unless turned off", () => {
  const e = readExam({ exam: base })!;
  assert.deepEqual([e.format, e.room, e.seats, e.hold, e.releasedAt], ["timed", "LH-2 · 204", null, true, null]);
  assert.equal(readExam({ exam: { ...base, closesAt: base.opensAt } }), null);
  assert.equal(readExam({ exam: { ...base, format: "oral" } }), null);
  assert.equal(readExam({}), null);
});

test("the paper is locked before opening; extra time moves only that student's close", () => {
  const e = readExam({ exam: base })!;
  assert.equal(paperLocked(e, Date.parse("2027-02-26T09:59:59Z")), true);
  assert.equal(paperLocked(e, Date.parse("2027-02-26T10:00:00Z")), false);
  assert.equal(paperLocked(readExam({ exam: { ...base, format: "take_home" } }), 0), false, "a take-home is visible from the start");
  const after = Date.parse("2027-02-26T12:10:00Z");
  assert.deepEqual([examPhase(e, after), examPhase(e, after, 30)], ["closed", "open"]);
  assert.equal(closeFor(e, 30).toISOString(), "2027-02-26T12:30:00.000Z");
});

test("state words: Paper opens · Closes in 42 min · Closed; held until released", () => {
  const e = readExam({ exam: base })!;
  assert.equal(examStateText(e, fmt, Date.parse("2027-02-25T10:00:00Z")), "Paper opens 10:00");
  assert.equal(examStateText(e, fmt, Date.parse("2027-02-26T11:18:00Z")), "Closes in 42 min");
  assert.equal(examStateText(e, fmt, Date.parse("2027-02-26T12:00:00Z")), "Closed");
  assert.equal(resultsHeld(e), true);
  assert.equal(resultsHeld({ ...e, releasedAt: "2027-03-01T00:00:00Z" }), false);
  assert.equal(overlaps(e, { opensAt: "2027-02-26T11:00:00Z", closesAt: "2027-02-26T13:00:00Z" }), true);
  assert.equal(overlaps(e, { opensAt: "2027-02-26T12:00:00Z", closesAt: "2027-02-26T13:00:00Z" }), false);
});

test("B1.6c: second marking reads its marker and sample; more than 10% apart needs agreement", () => {
  const e = readExam({ exam: { ...base, secondMarker: "u2", secondSample: "sample" } })!;
  assert.deepEqual([e.secondMarker, e.secondSample], ["u2", "sample"]);
  assert.equal(readExam({ exam: base })!.secondMarker, undefined);
  assert.deepEqual([needsAgreement(40, 45, 50), needsAgreement(40, 46, 50), needsAgreement(40, null, 50)], [false, true, false]);
});
