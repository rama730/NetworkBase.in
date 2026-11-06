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
    ["not_started", false, "Not started", "muted"], ["in_progress", false, "In progress", "info"], ["submitted", false, "In review", "warn"],
    ["done", true, "Approved", "ok"], ["done", false, "Done", "ok"], ["returned", false, "Returned", "danger"], ["missing", false, "Missing", "danger"], ["excused", false, "Excused", "muted"],
  ];
  for (const [state, approved, label, tone] of cases) assert.deepEqual(handInChip(state, approved), { label, tone }, state);
});

test("task 3: Hand in shows its chip, a coloured state box, file rows with sizes, and the late warning", async () => {
  const { readFileSync } = await import("node:fs");
  const hand = readFileSync("src/components/organizations/HandInSection.tsx", "utf8");
  assert.match(hand, /<span className="nb-status" data-status=\{TONE\[chip\.tone\]\}>\{chip\.label\}<\/span>/);
  assert.match(hand, /className=\{cn\('space-y-0\.5 rounded-\[5px\] px-3 py-2\.5', BOX\[box\.tone\]\)\}/);
  assert.match(hand, /<FileRow key=\{f\.nodeId\} file=\{f\}/);
  assert.match(hand, /\{fileSize\(file\.size\)\}/);
  assert.match(hand, /\{h\.wouldBeLate \? <p[^>]*>This will be marked Late\.<\/p> : null\}/);
});

test("board view dropdown §6a: an assignment card says who it's for and where everyone is, in one line", async () => {
  const { audienceLabel, cardLine, copyChip, copyStageLine } = await import("../../src/components/workspaces/tabs/sprint/AssignmentStages");
  const stages = (counts: Record<string, number>, extra = {}) => ({ counts: { not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 0, missing: 0, excused: 0, ...counts },
    total: Object.entries(counts).filter(([k]) => k !== "excused").reduce((n, [, v]) => n + v, 0), reviewRequired: true, teams: false, names: {} as never, remind: { not_started: [], missing: [] }, ...extra });
  assert.deepEqual(cardLine(stages({ done: 12, submitted: 6, missing: 3, in_progress: 19 })), { text: "12 of 40 approved · 6 in review · 3 missing", allDone: false });
  assert.deepEqual(cardLine(stages({ in_progress: 5, not_started: 3 }, { teams: true })), { text: "0 of 8 groups approved · 5 working", allDone: false });
  assert.deepEqual(cardLine(stages({ done: 39, excused: 1 })), { text: "All 39 approved · 1 excused", allDone: true });
  assert.equal(cardLine(stages({ done: 2, in_progress: 1 }, { reviewRequired: false })).text, "2 of 3 done · 1 working");
  assert.equal(audienceLabel({ mode: "everyone", count: 40 }), "Everyone · 40");
  assert.equal(audienceLabel({ mode: "teams", count: 8 }), "8 groups");
  assert.equal(audienceLabel({ mode: "role", count: 3 }), "Admins · 3");
  assert.equal(audienceLabel({ mode: "children", count: 1 }), "1 workspace");
  const returned = { state: "returned" as const, late: false, since: null, reason: "fix the README", fixBy: "2026-11-13T10:00:00.000Z", version: 1, reviewRequired: true, handIn: null };
  assert.deepEqual(copyChip(returned), { label: "Returned", tone: "danger" });
  assert.match(copyStageLine(returned), /^Returned: fix the README · fix by Nov 13$/);
  assert.deepEqual(copyChip({ ...returned, state: "done" }), { label: "Approved", tone: "success" });
  const card = (await import("node:fs")).readFileSync("src/components/workspaces/v2/tasks/TaskCard.tsx", "utf8");
  assert.doesNotMatch(card, /bits\.chips/, "no capital-letter chips above the title");
  assert.match(card, /audienceLabel\(taskRecord\.audience\)/, "who it's for, where a task shows its assignee");
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
  const aside = o.slice(o.indexOf('aria-label="Organization details"'), o.indexOf("</aside>"));
  assert.ok(aside.indexOf('<RailSection title="This week">') >= 0 && aside.indexOf('<RailSection title="Activity"') > aside.indexOf('<RailSection title="Workspaces"'));
});

test("live check: the panel's lists follow its tiles, the preview scrolls instead of clipping, and Return's box has a name", async () => {
  const { readFileSync } = await import("node:fs");
  const glance = readFileSync("src/components/organizations/AssignmentRoster.tsx", "utf8");
  assert.match(glance, /const countsKey = JSON\.stringify\(row\.counts\)/);
  assert.match(glance, /useEffect\(\(\) => \{ load\(\) \}, \[load, countsKey\]\)/);
  // Review UX 4.5: the viewer fills the column and scrolls inside itself.
  // Board/review report §2: the viewer takes its column's full height (the columns fill the screen).
  assert.match(readFileSync("src/components/organizations/ReviewQueueParts.tsx", "utf8"), /className="h-full min-h-\[50vh\] md:min-h-0"/);
  assert.match(readFileSync("src/components/organizations/FileViewer.tsx", "utf8"), /className="min-h-0 flex-1 overflow-auto" data-testid="file-viewer"/);
  assert.match(readFileSync("src/components/organizations/AssignmentDialogs.tsx", "utf8"), /aria-label="What should they change\?"/);
});
