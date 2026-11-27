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

// Plan A4.2: decisions use the ADR shape; the chain says which decision stands now.
test("decisionMarkdown: Context · Decision · Consequences, with the context when given", async () => {
  const { decisionMarkdown } = await import("../../src/lib/workspaces/doc-sections");
  assert.equal(decisionMarkdown("Use Postgres", "  Search is slow  "), "# Use Postgres\n\n## Context\n\nSearch is slow\n\n## Decision\n\nUse Postgres\n\n## Consequences\n\n");
  assert.equal(decisionMarkdown("Use Postgres"), "# Use Postgres\n\n## Context\n\n\n## Decision\n\nUse Postgres\n\n## Consequences\n\n");
});

test("decisionChain: D-9 superseded by D-15 → D-15; then by D-20 → D-20; a reversed end → none; a loop stops", async () => {
  const { decisionChain } = await import("../../src/lib/workspaces/doc-sections");
  const d = (id: string, decisionStatus: string, supersededBy?: string) => ({ id, decisionStatus, ...(supersededBy ? { supersededBy } : {}) });
  assert.equal(decisionChain([d("9", "superseded", "15"), d("15", "decided")], "9")!.id, "15");
  assert.equal(decisionChain([d("9", "superseded", "15"), d("15", "superseded", "20"), d("20", "proposed")], "9")!.id, "20");
  assert.equal(decisionChain([d("9", "superseded", "15"), d("15", "reversed")], "9"), null);
  assert.equal(decisionChain([d("9", "reversed")], "9"), null);
  assert.ok(decisionChain([d("a", "superseded", "b"), d("b", "superseded", "a")], "a"), "a loop ends instead of spinning");
  assert.equal(decisionChain([d("9", "decided")], "missing"), null);
});

// Plan A4.3–A4.14 (report 38.11 W2): each type's body.
test("type bodies: headings in order, guides, Decisions, a named Action items block; Standup per attendee", async () => {
  const { meetingMarkdown, meetingType, MEETING_TYPES, defaultTitle } = await import("../../src/lib/workflows/meetings");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const heads = (md: string) => md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
  assert.deepEqual(MEETING_TYPES.map((t) => t.id), ["weekly", "standup", "planning", "retro", "kickoff", "client", "recording", "shoot", "interview", "incident", "playtest", "board", "supervision", "department", "leadership", "line_management", "training", "general", "committee", "agm", "practice", "handover", "blank"]);
  // B1.8b (report 30.6): a thesis supervision.
  assert.deepEqual(heads(meetingMarkdown(meetingType("supervision")!, "S")), ["Agenda", "Notes", "Action items"]);
  const weekly = meetingMarkdown(meetingType("weekly")!, "Weekly · Dec 3");
  assert.deepEqual(heads(weekly), ["Agenda", "Notes", "Decisions", "Action items"]);
  assert.deepEqual(parseLiveBlocks(weekly).map((b) => [b.kind, b.key]), [["decisions", null], ["task_rows", "actions"]]);
  assert.deepEqual(heads(meetingMarkdown(meetingType("planning")!, "P")), ["Goal", "What's in", "What's out", "Action items"]);
  assert.deepEqual(heads(meetingMarkdown(meetingType("retro")!, "R")), ["What went well", "What needs improvement", "Ideas", "Action items"]);
  assert.deepEqual(heads(meetingMarkdown(meetingType("kickoff")!, "K")), ["Why", "Scope", "People", "Dates", "Risks", "Action items"]);
  const client = meetingMarkdown(meetingType("client")!, "C");
  assert.deepEqual(heads(client), ["Agenda", "Notes", "Next steps"]);
  assert.deepEqual(parseLiveBlocks(client).map((b) => b.key), ["actions"], "Next steps is the action items block, so Finish carries it");
  assert.deepEqual(heads(meetingMarkdown(meetingType("recording")!, "x")), ["Tech checklist", "Prep questions", "Timings"]);
  assert.deepEqual(heads(meetingMarkdown(meetingType("shoot")!, "x")), ["Call time", "Location", "Crew and cast", "Equipment", "Shots to get", "Weather and notes"]);
  const interview = meetingMarkdown(meetingType("interview")!, "x");
  assert.deepEqual(heads(interview), ["Participant", "Consent to record", "Research goal", "Questions", "Notes", "Insights"]);
  assert.match(interview, /## Consent to record\n\n- \[ \] They agreed to be recorded/);
  const incident = meetingMarkdown(meetingType("incident")!, "x");
  assert.deepEqual(heads(incident), ["Linked bug", "Timeline", "Root cause", "Lessons", "Actions"]);
  assert.match(incident, /## Timeline\n\n_Blameless/);
  assert.deepEqual(heads(meetingMarkdown(meetingType("playtest")!, "x")), ["Build", "Tester", "Minutes played", "What I saw", "Fun moments", "Confusion", "Bugs", "Ideas"]);
  const standup = meetingMarkdown(meetingType("standup")!, "Standup · Dec 3", ["Asha", "Dev"]);
  assert.deepEqual(heads(standup), ["Asha", "Dev"]);
  assert.match(standup, /## Asha\n\n\*\*Yesterday:\*\* \n\n\*\*Today:\*\* \n\n\*\*Blockers:\*\* \n/);
  assert.deepEqual(heads(meetingMarkdown(meetingType("standup")!, "S")), ["Everyone"]);
  assert.equal(defaultTitle(meetingType("retro")!, "2026-12-03"), "Retrospective · Dec 3");
});

// Plan A4.9 (report 38.11 W6, call 6): Board meetings: majority quorum, simple-majority motions, votes within those present.
test("board rules: quorum is a majority of the board; a motion passes on more For than Against; votes can't exceed those present", async () => {
  const { quorum, motionResult, voteFits, meetingMarkdown, meetingType } = await import("../../src/lib/workflows/meetings");
  assert.deepEqual(quorum(7, 4), { needed: 4, met: true });
  assert.deepEqual(quorum(7, 3), { needed: 4, met: false });
  assert.deepEqual(quorum(6, 3), { needed: 4, met: false });
  assert.deepEqual(quorum(null, 2), { needed: 1, met: true }, "no board size: anyone present is enough");
  assert.equal(motionResult(3, 2), "passed");
  assert.equal(motionResult(2, 2), "failed", "a tie fails");
  assert.equal(motionResult(0, 0), "failed");
  assert.equal(voteFits({ for: 3, against: 1, abstain: 0 }, 4), true);
  assert.equal(voteFits({ for: 3, against: 1, abstain: 1 }, 4), false);
  const md = meetingMarkdown(meetingType("board")!, "Board · Dec 3");
  assert.deepEqual(md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3)), ["Agenda", "Reports", "Motions", "Minutes", "Decisions"]);
});

// Plan A4.16 (report 38.11 S8, call 5): Settings → Meetings.
test("meetingSettings: types follow the category until set; Blank always on; length and reminder fall back to 30 and 15", async () => {
  const { meetingSettings } = await import("../../src/lib/workflows/meetings");
  const common = ["weekly", "standup", "planning", "retro", "kickoff", "client", "blank"];
  assert.deepEqual(meetingSettings(null, null), { types: common, lengthMinutes: 30, reminderMinutes: 15 });
  assert.deepEqual(meetingSettings(undefined, "startup").types, ["weekly", "standup", "planning", "retro", "kickoff", "client", "interview", "board", "blank"]);
  assert.deepEqual(meetingSettings(undefined, "game").types, ["weekly", "standup", "planning", "retro", "kickoff", "client", "playtest", "blank"]);
  assert.deepEqual(meetingSettings(undefined, "podcast").types.includes("recording"), true);
  assert.deepEqual(meetingSettings({ types: ["board", "nope", "weekly"], lengthMinutes: 45, reminderMinutes: 0 }, "game"), { types: ["weekly", "board", "blank"], lengthMinutes: 45, reminderMinutes: 0 },
    "set types win, in catalog order, unknown dropped, Blank kept");
  assert.deepEqual(meetingSettings({ lengthMinutes: 7, reminderMinutes: 10 }, null), { types: common, lengthMinutes: 30, reminderMinutes: 15 }, "only allowed values");
});

test("B3.5a: a school gets Department, Leadership, Line management and Training session meetings", async () => {
  const { meetingSettings } = await import("../../src/lib/workflows/meetings");
  const types = meetingSettings(undefined, "school").types;
  assert.ok(["department", "leadership", "line_management", "training"].every((t) => types.includes(t)));
  assert.equal(meetingSettings(undefined, "startup").types.includes("department"), false);
  assert.ok(meetingSettings(undefined, "club").types.includes("handover"), "B7.2c: a club gets the Handover meeting");
});

test("B7.3a: club meetings — motions on General and AGM, officers-only minutes, quorum a quarter of those staying", async () => {
  const { approvesMinutes, clubQuorumNeeded, hasMotions, isClubMinutes, meetingSettings } = await import("../../src/lib/workflows/meetings");
  assert.ok(["general", "committee", "agm", "handover"].every((t) => meetingSettings(undefined, "club").types.includes(t)));
  assert.deepEqual(["board", "general", "agm", "committee", "weekly"].map(hasMotions), [true, true, true, false, false]);
  assert.deepEqual(["general", "committee", "agm", "board"].map(isClubMinutes), [true, true, true, false]);
  assert.ok(approvesMinutes("committee") && approvesMinutes("board") && !approvesMinutes("weekly"));
  assert.equal(clubQuorumNeeded(100), 25);
  assert.equal(clubQuorumNeeded(101), 26);
  assert.equal(clubQuorumNeeded(0), 1);
  assert.equal(clubQuorumNeeded(9, 0.5), 5);
});

