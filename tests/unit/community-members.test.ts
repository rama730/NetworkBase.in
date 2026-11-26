import assert from "node:assert/strict";
import { test } from "node:test";

import { isNewMember, memberStatus, pauseActive, readMembersSettings } from "../../src/lib/organizations/community";

const now = new Date("2026-11-26T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

test("34.3 call 4: New for 30 days, then Active until quietDays without activity, then Quiet", () => {
  assert.equal(isNewMember(ago(29), now), true);
  assert.equal(isNewMember(ago(31), now), false);
  assert.equal(isNewMember(null, now), false);
  assert.equal(memberStatus(ago(10), null, now, 60), "new");
  assert.equal(memberStatus(ago(100), ago(20), now, 60), "active");
  assert.equal(memberStatus(ago(100), ago(61), now, 60), "quiet");
  assert.equal(memberStatus(ago(100), null, now, 60), "quiet", "never active after the first 30 days");
  assert.equal(memberStatus(ago(40), null, now, 60), "active", "joined counts as activity");
});

test("34.3 settings: Quiet after 14–365 days, Helper renameable, pauses only 24 h or 7 days", () => {
  assert.deepEqual(readMembersSettings(null), { quietDays: 60, helperWord: "Helper", pauseHours: [24, 168] });
  assert.deepEqual(readMembersSettings({ community: { members: { quietDays: 5, helperWord: "  Ask me for help ", pauseHours: [1, 168] } } }), { quietDays: 60, helperWord: "Ask me for help", pauseHours: [168] });
});

test("34.3: a pause ends on its own", () => {
  assert.equal(pauseActive({ until: ago(-1) }, now), true);
  assert.equal(pauseActive({ until: ago(1) }, now), false);
  assert.equal(pauseActive(null, now), false);
});
