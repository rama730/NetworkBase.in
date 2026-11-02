import assert from "node:assert/strict";
import test from "node:test";

import { aboutStages, classStanding, getStartedCards, todayRows, weekGroup, weekLine } from "@/lib/organizations/dashboard-rules";

// Step 4 (report §7.2, §33.5): the Overview rules, pure so the server and the screen agree.

const empty = { members: 1, sprints: 0, tasks: 0, workspaces: 0, announcements: 0, documents: 0, files: 0 };

test("7.2, decision 7: Get started is three cards while the organization is empty, and gone once anything real exists", () => {
  assert.deepEqual(getStartedCards(empty), ["invite", "sprint", "workspace"]);
  for (const key of Object.keys(empty) as Array<keyof typeof empty>) {
    assert.deepEqual(getStartedCards({ ...empty, [key]: key === "members" ? 2 : 1 }), [], key);
  }
});

test("33.5: the week line counts from the term start, and stays away without a term", () => {
  const start = "2026-08-03", end = "2026-11-20";
  assert.equal(weekLine(start, end, new Date("2026-09-08T10:00:00Z"), "UTC"), "Week 6 of 16");
  assert.equal(weekLine(null, end, new Date("2026-09-08T10:00:00Z"), "UTC"), null);
  assert.equal(weekLine(start, end, new Date("2026-12-01T10:00:00Z"), "UTC"), null, "after the term");
});

test("parity bug 7, decision 80: This week counts calendar days in the organization's zone", () => {
  const now = new Date("2026-11-02T18:00:00Z"); // 23:30 in India, Monday
  assert.equal(weekGroup(new Date("2026-11-02T18:20:00Z"), now, "Asia/Kolkata"), "Today");
  assert.equal(weekGroup(new Date("2026-11-03T05:00:00Z"), now, "Asia/Kolkata"), "Tomorrow");
  assert.equal(weekGroup(new Date("2026-11-09T17:00:00Z"), now, "Asia/Kolkata"), "This week", "day 7 counts even past 168 hours");
  assert.equal(weekGroup(new Date("2026-11-09T19:00:00Z"), now, "Asia/Kolkata"), null, "day 8 doesn't");
  assert.equal(weekGroup(new Date("2026-11-01T10:00:00Z"), now, "Asia/Kolkata"), null, "the past isn't this week");
});

test("decision 81: on track, behind and inactive add up to the class, behind first", () => {
  assert.deepEqual(classStanding([{ behind: false, inactive: false }, { behind: true, inactive: true }, { behind: false, inactive: true }, { behind: true, inactive: false }]),
    { onTrack: 1, behind: 2, inactive: 1 });
});

test("33.5, decision 80: Today puts deadlines and sprint endings first, then the term-end prompt and the rest", () => {
  const rows = todayRows({
    dueToday: [{ title: "Lab 3", handedIn: 28, total: 40, href: "/t" }],
    sprintsEnding: [{ name: "CO3", endDate: new Date("2026-11-05T18:00:00Z"), behind: 4, href: "/s" }],
    termEnd: { date: "2026-11-15", href: "/m" },
    attention: [{ kind: "review", label: "6 submissions to review · Lab 2", href: "/r" }],
  }, new Date("2026-11-03T08:00:00Z"), "UTC");
  assert.deepEqual(rows.map((r) => r.label), ["Lab 3 due today · 28 of 40 in", "CO3 ends Thu · 4 behind", "Term ends 15 Nov · Review open work, verify members, then archive or duplicate", "6 submissions to review · Lab 2"]);
});

test("7.3, decision 79, gaps 5 and 6: About's stages teach when empty and never show a lone dot", () => {
  assert.equal(aboutStages(0, "admin"), "ghost");
  assert.equal(aboutStages(0, "member"), "hint");
  assert.equal(aboutStages(0, "visitor"), null);
  assert.equal(aboutStages(1, "visitor"), "single");
  assert.equal(aboutStages(3, "member"), "timeline");
});
