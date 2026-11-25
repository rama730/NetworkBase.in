import assert from "node:assert/strict";
import test from "node:test";

import { eventFieldsSchema } from "@/lib/organizations/school-events";
import { kindOf, parseCsv, parseIcs } from "@/lib/organizations/school-import";
import { dayAt, planNextYear, termPlace } from "@/lib/organizations/school-next-year";
import { schoolYearSchema } from "@/lib/organizations/school-year";

const y1 = schoolYearSchema.parse({ name: "2026–27", terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-12-18" }, { name: "Term 2", start: "2027-01-06", end: "2027-03-26" }] });
const y2 = schoolYearSchema.parse({ name: "2027–28", terms: [{ name: "Term 1", start: "2027-09-01", end: "2027-12-17" }, { name: "Term 2", start: "2028-01-05", end: "2028-02-04" }] });
const ev = (id: string, f: Record<string, unknown>) => ({ id, title: id, fields: eventFieldsSchema.parse(f) });

test("Start next year: same term week and weekday", () => {
  // Tue 2026-09-15 is Week 3 of Term 1 (Term 1 starts Wed 2026-09-02).
  assert.deepEqual(termPlace("2026-09-15", y1), { term: 0, week: 3, weekday: 1 });
  assert.equal(dayAt({ term: 0, week: 3, weekday: 1 }, y2), "2027-09-14");
  assert.equal(termPlace("2026-12-25", y1), null);
});

test("repeats are copied, one-offs offered, places the new year lacks can't move", () => {
  const plan = planNextYear([
    ev("Briefing", { date: "2026-09-07", repeat: { every: 1, until: "2026-12-14" } }),
    ev("Parents", { date: "2026-10-13" }),
    ev("Spring fair", { date: "2027-03-22" }),
  ], y1, y2);
  assert.deepEqual(plan.copy.map((e) => [e.title, e.fields.date, e.fields.repeat?.until]), [["Briefing", "2027-09-06", "2027-12-13"]]);
  assert.deepEqual(plan.offer.map((e) => [e.title, e.from, e.fields.date]), [["Parents", "2026-10-13", "2027-10-12"]]);
  assert.deepEqual(plan.cannot.map((e) => e.title), ["Spring fair"], "Term 2 is shorter next year");
});

test("import: CSV with a header, kinds from the type or name, errors per row", () => {
  const rows = parseCsv('name,type,start,end,time,place\nWinter break,Holiday,2026-12-21,2027-01-01,,\nINSET,,2027-01-05,,,\n"Parents\' evening, Y7",event,2026-11-12,,18:00,Hall\nBad,,2026-02-30,,,');
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.start, r.end, r.time, r.error]), [
    ["Winter break", "holiday", "2026-12-21", "2027-01-01", null, null],
    ["INSET", "staff", "2027-01-05", "2027-01-05", null, null],
    ["Parents' evening, Y7", "event", "2026-11-12", "2026-11-12", "18:00", null],
    ["Bad", "event", "2026-02-30", "2026-02-30", null, "Start isn’t a date (YYYY-MM-DD)"],
  ]);
  assert.equal(kindOf("Half day"), "half");
  assert.equal(kindOf("Half-term"), "holiday");
});

test("import: .ics all-day ends are exclusive; folded lines and escapes", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Spring\r\n  break\r\nDTSTART;VALUE=DATE:20270405\r\nDTEND;VALUE=DATE:20270410\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Open evening\\, all years\r\nDTSTART:20261105T180000\r\nLOCATION:Hall\r\nEND:VEVENT\r\nEND:VCALENDAR";
  assert.deepEqual(parseIcs(ics).map((r) => [r.name, r.kind, r.start, r.end, r.time, r.place, r.error]), [
    ["Spring break", "holiday", "2027-04-05", "2027-04-09", null, "", null],
    ["Open evening, all years", "event", "2026-11-05", "2026-11-05", "18:00", "Hall", null],
  ]);
});
