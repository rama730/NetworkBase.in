import assert from "node:assert/strict";
import { test } from "node:test";

// Organization mockup parity (docs/superpowers/plans/2026-11-04-org-mockup-parity.md).

test("task 1: the four tiles count Done, Submitted, Not in and Excused", async () => {
  const { rosterTiles } = await import("../../src/lib/organizations/assignment-rules");
  assert.deepEqual(rosterTiles({ done: 22, submitted: 6, not_started: 4, in_progress: 3, returned: 1, missing: 2, excused: 2, total: 38 }), { done: 22, submitted: 6, notIn: 10, excused: 2 });
  assert.deepEqual(rosterTiles({ done: 0, submitted: 0, not_started: 0, in_progress: 0, returned: 0, missing: 0, excused: 0, total: 0 }), { done: 0, submitted: 0, notIn: 0, excused: 0 });
});

test("task 3: the hand-in chip names each state in its tone", async () => {
  const { handInChip } = await import("../../src/lib/organizations/assignment-rules");
  const cases: Array<[Parameters<typeof handInChip>[0], boolean, string, string]> = [
    ["not_started", false, "Not started", "muted"], ["in_progress", false, "In progress", "info"], ["submitted", false, "Submitted", "warn"],
    ["done", true, "Approved", "ok"], ["done", false, "Done", "ok"], ["returned", false, "Returned", "danger"], ["missing", false, "Missing", "danger"], ["excused", false, "Excused", "muted"],
  ];
  for (const [state, approved, label, tone] of cases) assert.deepEqual(handInChip(state, approved), { label, tone }, state);
});

test("task 3: Hand in shows its chip, a coloured state box, file rows with sizes, and the late warning", async () => {
  const { readFileSync } = await import("node:fs");
  const hand = readFileSync("src/components/organizations/HandInSection.tsx", "utf8");
  assert.match(hand, /<span className="nb-status" data-status=\{TONE\[chip\.tone\]\}>\{chip\.label\}<\/span>/);
  assert.match(hand, /\{h\.returned\.by \?\? h\.from\} returned this/);
  assert.match(hand, /<FileRow key=\{f\.nodeId\} name=\{f\.name\} bytes=\{f\.size\}/);
  assert.match(hand, /\{h\.wouldBeLate \? <p[^>]*>This will be marked Late\.<\/p> : null\}/);
});

test("task 4: an assignment card shows its chips, a progress bar and the done line", async () => {
  const { assignmentCardBits } = await import("../../src/components/workspaces/v2/tasks/TaskCard");
  assert.deepEqual(assignmentCardBits({ draft: false, closed: false, done: 22, total: 40, toReview: 6, excused: 0 }), { chips: ["Assignment", "6 to review"], percent: 55, line: "22 of 40 done · 6 to review" });
  assert.deepEqual(assignmentCardBits({ draft: false, closed: false, done: 0, total: 0, toReview: 0, excused: 0 }), { chips: ["Assignment"], percent: 0, line: "Nobody has joined yet" });
  assert.deepEqual(assignmentCardBits({ draft: true, closed: false, done: 0, total: 40, toReview: 0, excused: 0 }).chips, ["Draft", "Assignment"]);
  assert.deepEqual(assignmentCardBits({ draft: false, closed: false, done: 3, total: 12, toReview: 0, excused: 0, teams: true }).chips, ["Assignment", "Groups"]);
});

test("task 5: the Overview greets by time of day and first name", async () => {
  const { greetingFor } = await import("../../src/lib/organizations/dashboard-rules");
  assert.equal(greetingFor(8, "Ramanayudu CH"), "Good morning, Ramanayudu");
  assert.equal(greetingFor(14, null), "Good afternoon");
  assert.equal(greetingFor(22, "Asha Rao"), "Good evening, Asha");
  assert.equal(greetingFor(4, "Asha Rao"), "Good evening, Asha");
});

test("task 5: the greeting heads Overview, the class bar has three parts, and This week and Activity sit in the right column", async () => {
  const { readFileSync } = await import("node:fs");
  const o = readFileSync("src/components/organizations/OrgOverviewParts.tsx", "utf8");
  assert.match(o, /<h2 className="[^"]*">\{data\.greeting\}<\/h2>/);
  assert.match(o, /role="img" aria-label=\{`\$\{data\.standing\.onTrack\} on track, \$\{data\.standing\.behind\} behind, \$\{data\.standing\.inactive\} inactive`\}/);
  const aside = o.slice(o.indexOf('<aside aria-label="Organization details"'), o.indexOf("</aside>"));
  assert.ok(aside.indexOf('<RailSection title="This week">') >= 0 && aside.indexOf('<RailSection title="Activity"') > aside.indexOf('<RailSection title="Workspaces"'));
});

test("live check: the panel's lists follow its tiles, the preview scrolls instead of clipping, and Return's box has a name", async () => {
  const { readFileSync } = await import("node:fs");
  const glance = readFileSync("src/components/organizations/AssignmentGlance.tsx", "utf8");
  assert.match(glance, /const countsKey = JSON\.stringify\(row\.counts\)/);
  assert.match(glance, /useEffect\(\(\) => \{ load\(\) \}, \[load, countsKey\]\)/);
  assert.match(readFileSync("src/components/organizations/ReviewQueueParts.tsx", "utf8"), /className="h-\[60vh\] overflow-auto rounded-md/);
  assert.match(readFileSync("src/components/organizations/AssignmentDialogs.tsx", "utf8"), /aria-label="What should they change\?"/);
});
