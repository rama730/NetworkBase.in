import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.11 D1 part 7 (plan A4.1): meeting rules.
test("nextOccurrence: weekly, every 2 weeks, weekdays skip the weekend, monthly 31st → the month's last day, DST keeps 10:00", async () => {
  const { nextOccurrence } = await import("../../src/lib/workflows/meetings");
  const ist = (s: string) => new Date(`${s}+05:30`).toISOString();
  assert.equal(nextOccurrence("weekly", ist("2026-12-03T10:00:00"), "Asia/Kolkata"), ist("2026-12-10T10:00:00"));
  assert.equal(nextOccurrence("biweekly", ist("2026-12-03T10:00:00"), "Asia/Kolkata"), ist("2026-12-17T10:00:00"));
  assert.equal(nextOccurrence("weekdays", ist("2026-12-04T10:00:00"), "Asia/Kolkata"), ist("2026-12-07T10:00:00"), "Friday → Monday");
  assert.equal(nextOccurrence("monthly", ist("2027-01-31T10:00:00"), "Asia/Kolkata"), ist("2027-02-28T10:00:00"));
  assert.equal(nextOccurrence("monthly", ist("2027-02-28T10:00:00"), "Asia/Kolkata", 31), ist("2027-03-31T10:00:00"), "the anchor day comes back");
  // New York leaves daylight saving on 1 Nov 2026: 10:00 stays 10:00 local.
  assert.equal(nextOccurrence("weekly", "2026-10-29T14:00:00.000Z", "America/New_York"), "2026-11-05T15:00:00.000Z");
});

test("isNow, carryRows, reminderAt, meetingWhen", async () => {
  const { isNow, carryRows, reminderAt, meetingWhen } = await import("../../src/lib/workflows/meetings");
  assert.equal(isNow("2026-12-03T04:30:00.000Z", 30, new Date("2026-12-03T04:45:00.000Z")), true);
  assert.equal(isNow("2026-12-03T04:30:00.000Z", 30, new Date("2026-12-03T05:00:00.000Z")), false);
  assert.deepEqual(carryRows([{ status: "done" }, { status: "todo" }, { status: "in_progress" }, { status: "todo", stage: "cancelled" }]).map((r) => r.status), ["todo", "in_progress"]);
  assert.equal(reminderAt("2026-12-03T04:30:00.000Z", 15), "2026-12-03T04:15:00.000Z");
  assert.equal(reminderAt("2026-12-03T04:30:00.000Z", 0), null);
  assert.equal(meetingWhen("2026-12-03T04:30:00.000Z", 30, "Asia/Kolkata"), "Thu 3 Dec · 10:00–10:30 (Asia/Kolkata)");
});

test("meetingMarkdown: the type's sections then the Action items block with its fixed key; default title", async () => {
  const { meetingMarkdown, meetingType, defaultTitle } = await import("../../src/lib/workflows/meetings");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const md = meetingMarkdown(meetingType("blank")!, "Meeting · Dec 3");
  assert.match(md, /^# Meeting · Dec 3\n\n## Notes\n/);
  assert.deepEqual(parseLiveBlocks(md).map((b) => [b.kind, b.key]), [["task_rows", "actions"]]);
  assert.equal(defaultTitle(meetingType("blank")!, "2026-12-03"), "Meeting · Dec 3");
});

// Plan A4.1b: the .ics feed and the month grid.
test("icsCalendar: UTC times, escaped text, CRLF, folded long lines", async () => {
  const { icsCalendar } = await import("../../src/lib/workflows/meetings");
  const ics = icsCalendar([{ uid: "d1@networkbase", title: "Weekly; team, sync", startsAt: "2027-01-07T04:30:00.000Z", lengthMinutes: 30, url: "https://networkbase.in/workspaces/acme?tab=docs&doc=" + "x".repeat(80) }], new Date("2026-11-23T00:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /DTSTART:20270107T043000Z\r\nDTEND:20270107T050000Z\r\nSUMMARY:Weekly\\; team\\, sync\r\n/);
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75), "lines fold at 75 octets");
  assert.match(ics, /\r\n /, "a folded line continues with a space");
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("monthGrid: six weeks from Monday; meetings on their local day in time order", async () => {
  const { monthGrid } = await import("../../src/lib/workflows/meetings");
  const g = monthGrid("2027-01", [{ startsAt: "2027-01-07T08:30:00.000Z", t: "b" }, { startsAt: "2027-01-07T04:30:00.000Z", t: "a" }, { startsAt: "2027-01-31T20:00:00.000Z", t: "c" }, { startsAt: null, t: "x" }], "Asia/Kolkata");
  assert.equal(g.length, 42);
  assert.equal(g[0]!.day, "2026-12-28");
  assert.deepEqual(g.find((d) => d.day === "2027-01-07")!.meetings.map((m) => [m.t, m.time]), [["a", "10:00"], ["b", "14:00"]]);
  assert.deepEqual(g.find((d) => d.day === "2027-02-01")!.meetings.map((m) => m.t), ["c"], "01:30 next day in Kolkata");
});

test("security review: icsCalendar never lets a title start a new line (CR, LF, CRLF, other control characters)", async () => {
  const { icsCalendar } = await import("../../src/lib/workflows/meetings");
  const title = "A\rATTENDEE:mailto:x@evil.test\nB\r\nC\u0007D; E, F";
  const ics = icsCalendar([{ uid: "d1@networkbase", title, startsAt: "2027-01-07T04:30:00.000Z", lengthMinutes: 30, url: "https://networkbase.in/x" }], new Date("2026-11-23T00:00:00Z"));
  const summary = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  assert.equal(summary, "SUMMARY:A\\nATTENDEE:mailto:x@evil.test\\nB\\nCD\\; E\\, F");
  assert.ok(!ics.split("\r\n").some((l) => l.startsWith("ATTENDEE")), "no injected property line");
});
