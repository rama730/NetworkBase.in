import assert from "node:assert/strict";
import { test } from "node:test";

import { audienceAllows, isPinnedNow, pinLimit, shareBlock } from "../../src/lib/organizations/update-rules";

// Report §17.3–17.6.
test("audience: everyone by default; a role or child projects narrow it; admins and the author always see it", () => {
  const member = { isAdmin: false, isAuthor: false, role: "member" as const, childProjectIds: ["c1"] };
  assert.equal(audienceAllows({}, member), true);
  assert.equal(audienceAllows({ roles: ["admin"] }, member), false);
  assert.equal(audienceAllows({ roles: ["member"] }, member), true);
  assert.equal(audienceAllows({ projectIds: ["c2"] }, member), false);
  assert.equal(audienceAllows({ projectIds: ["c1"] }, member), true);
  assert.equal(audienceAllows({ roles: ["admin"] }, { ...member, isAdmin: true }), true);
  assert.equal(audienceAllows({ roles: ["admin"] }, { ...member, isAuthor: true }), true);
  assert.equal(audienceAllows({ roles: ["member"] }, { ...member, role: "viewer" }), false, "guests only see posts for everyone");
});

test("pins: up to 3 in an org, 1 elsewhere; an unpin date ends a pin quietly", () => {
  assert.equal(pinLimit("organization"), 3);
  assert.equal(pinLimit("project"), 1);
  const now = new Date("2026-11-01T00:00:00Z");
  assert.equal(isPinnedNow(true, null, now), true);
  assert.equal(isPinnedNow(true, new Date("2026-11-02T00:00:00Z"), now), true);
  assert.equal(isPinnedNow(true, new Date("2026-10-31T00:00:00Z"), now), false);
  assert.equal(isPinnedNow(false, null, now), false);
});

test("share to org: blocked for Private workspaces and when the org turned sharing off", () => {
  assert.equal(shareBlock({ childVisibility: "org", orgAllowsShare: true }), null);
  assert.equal(shareBlock({ childVisibility: "private", orgAllowsShare: true }), "Private workspaces can’t share to the org.");
  assert.equal(shareBlock({ childVisibility: "public", orgAllowsShare: false }), "The organization turned sharing off.");
});
