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
