import assert from "node:assert/strict";
import { test } from "node:test";

import { isRecruiting, readRecruiting } from "../../src/lib/organizations/club";
import { CLUB_GETTING_STARTED, hasFrontDoor, readCommunitySettings } from "../../src/lib/organizations/community";

// Report 36.2 (B7.1a): the recruiting period turns itself off; clubs share the front door with club Getting started.
test("recruiting: from the start date through the end date, then off", () => {
  const r = readRecruiting({ club: { recruiting: { from: "2026-09-01", to: "2026-09-14", line: "Taster night", firstEventId: null } } });
  assert.ok(r);
  assert.equal(isRecruiting(r, "2026-08-31"), false);
  assert.equal(isRecruiting(r, "2026-09-01"), true);
  assert.equal(isRecruiting(r, "2026-09-14"), true);
  assert.equal(isRecruiting(r, "2026-09-15"), false);
  assert.equal(readRecruiting({ club: { recruiting: { from: "2026-09-14", to: "2026-09-01", line: "", firstEventId: null } } }), null, "an end before the start is no period");
});

test("clubs get the front door and their own Getting started", () => {
  assert.ok(hasFrontDoor("club") && hasFrontDoor("community") && !hasFrontDoor("company"));
  assert.deepEqual(readCommunitySettings({}, "club").gettingStarted, CLUB_GETTING_STARTED);
  assert.notDeepEqual(readCommunitySettings({}, "community").gettingStarted, CLUB_GETTING_STARTED);
});

test("Season renewal: states, new joiners not asked, the window", async () => {
  const { renewalState, windowClosed } = await import("../../src/lib/organizations/club");
  const r = { on: true, season: "2026-09-01", ask: "Staying this Season?", days: 30 };
  assert.equal(renewalState(r, null, "2025-01-01T00:00:00Z"), "not_answered");
  assert.equal(renewalState(r, { season: "2026-09-01", answer: "staying" }, "2025-01-01T00:00:00Z"), "staying");
  assert.equal(renewalState(r, { season: "2025-09-01", answer: "staying" }, "2025-01-01T00:00:00Z"), "not_answered", "last Season's answer doesn't count");
  assert.equal(renewalState(r, null, "2026-08-20T00:00:00Z"), "not_asked", "joined in the 30 days before");
  assert.equal(windowClosed(r, "2026-09-30"), false);
  assert.equal(windowClosed(r, "2026-10-01"), true);
});

test("positions: the starter list and a Season name until the President saves their own", async () => {
  const { readPositions, STARTER_POSITIONS } = await import("../../src/lib/organizations/club");
  const p = readPositions({}, new Date("2026-11-27T00:00:00Z"));
  assert.equal(p.season, "2026–27");
  assert.deepEqual(p.positions, STARTER_POSITIONS);
  assert.equal(p.positions.filter((x) => x.gives === "president").length, 1);
  assert.equal(readPositions({}, new Date("2026-03-01T00:00:00Z")).season, "2025–26");
});

test("tally: the most votes wins; abstain counts only as turnout; a tie goes to a run-off; no votes leaves it open", async () => {
  const { tally } = await import("../../src/lib/organizations/club");
  assert.deepEqual(tally(["a", "b", "a", null], ["a", "b"]), { counts: { a: 2, b: 1 }, abstained: 1, winner: "a", tied: [] });
  assert.deepEqual(tally(["a", "b", null], ["a", "b", "c"]).tied, ["a", "b"]);
  assert.equal(tally(["a", "b"], ["a", "b"]).winner, null);
  assert.deepEqual(tally([null, null], ["a"]), { counts: { a: 0 }, abstained: 2, winner: null, tied: [] });
  assert.equal(tally(["x"], ["a"]).winner, null, "a choice that isn't a candidate counts for nobody");
});
