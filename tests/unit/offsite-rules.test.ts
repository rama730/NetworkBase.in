import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.14 D5 part 7 (plan A5.4): off-site rules.
test("offsiteCounts: going, can't go and not answered, only for people still invited", async () => {
  const { offsiteCounts } = await import("../../src/lib/workflows/offsite");
  assert.deepEqual(offsiteCounts(["a", "b", "c", "d"], { a: "going", b: "cant", x: "going" }), { going: 1, cant: 1, unanswered: 2 });
  assert.deepEqual(offsiteCounts([], {}), { going: 0, cant: 0, unanswered: 0 });
});

test("travelRows: one Book travel row per invitee, assigned to them", async () => {
  const { travelRows } = await import("../../src/lib/workflows/offsite");
  assert.deepEqual(travelRows([{ id: "a", name: "Asha" }, { id: "b", name: "Dev" }]), [{ title: "Book travel — Asha", assigneeId: "a" }, { title: "Book travel — Dev", assigneeId: "b" }]);
});

test("offsiteMarkdown: title, agenda by day, the four checklist blocks with fixed keys", async () => {
  const { offsiteMarkdown, OFFSITE_BLOCKS } = await import("../../src/lib/workflows/offsite");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const md = offsiteMarkdown("Team off-site", "2027-03-04", "2027-03-06");
  assert.match(md, /^# Team off-site\n/);
  assert.match(md, /## Agenda\n\n### Day 1 · Thu 4 Mar\n\n### Day 2 · Fri 5 Mar\n\n### Day 3 · Sat 6 Mar\n/);
  assert.deepEqual(parseLiveBlocks(md).map((b) => [b.key, b.label]), OFFSITE_BLOCKS.map((b) => [b.key, b.label]));
  assert.deepEqual(OFFSITE_BLOCKS.map((b) => b.label), ["Before", "Travel and rooms", "Sessions", "After"]);
});

test("daysUntil and offsiteLine for the Overview card", async () => {
  const { daysUntil, offsiteLine } = await import("../../src/lib/workflows/offsite");
  assert.equal(daysUntil("2027-03-04", "2027-02-20"), 12);
  assert.equal(offsiteLine("Team off-site", 12, 2), "Off-site in 12 days · 2 not answered");
  assert.equal(offsiteLine("Team off-site", 0, 0), "Off-site today · everyone answered");
  assert.equal(offsiteLine("Team off-site", 1, 1), "Off-site tomorrow · 1 not answered");
});
