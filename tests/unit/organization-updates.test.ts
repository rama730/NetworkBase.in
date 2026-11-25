import assert from "node:assert/strict";
import { test } from "node:test";

import { audienceAllows, audienceChange, audienceLabel, companyPinUntil, followersHear, isPinnedNow, pinLimit, shareBlock } from "../../src/lib/organizations/update-rules";

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

test("decision 153: followers hear only Public posts on a public workspace that are meant for everyone", () => {
  const base = { visibility: "public", projectVisibility: "public", audience: {} } as const;
  assert.equal(followersHear(base), true);
  assert.equal(followersHear({ ...base, audience: { roles: ["admin" as const] } }), false, "a limited announcement stays inside");
  assert.equal(followersHear({ ...base, visibility: "members" }), false);
  assert.equal(followersHear({ ...base, projectVisibility: "org" }), false);
});

test("37.3: changing an audience later: widening asks first, narrowing applies at once", () => {
  const members = { audience: {}, visibility: "members" };
  assert.equal(audienceChange({ audience: { roles: ["member"] }, visibility: "members" }, members), "wider");
  assert.equal(audienceChange(members, { audience: { roles: ["admin"] }, visibility: "members" }), "narrower");
  assert.equal(audienceChange(members, { audience: {}, visibility: "public" }), "wider", "Public reaches outside");
  assert.equal(audienceChange({ audience: { roles: ["member"] }, visibility: "members" }, { audience: { roles: ["viewer"] }, visibility: "members" }), "mixed");
  assert.equal(audienceChange(members, { audience: {}, visibility: "members" }), "same");
});

test("37.3: the card's audience label names the reach in the organization's words", () => {
  const roles = { admin: "Teacher", member: "Student", viewer: "Guest" };
  const titles = new Map([["a", "Team Falcon"], ["b", "Team Owl"], ["c", "Team Kite"]]);
  assert.equal(audienceLabel({ audience: {}, visibility: "public" }, roles, titles), "Public");
  assert.equal(audienceLabel({ audience: {}, visibility: "members" }, roles, titles), "Members");
  assert.equal(audienceLabel({ audience: { roles: ["admin"] }, visibility: "members" }, roles, titles), "Teachers");
  assert.equal(audienceLabel({ audience: { roles: ["member"] }, visibility: "members" }, roles, titles), "Students");
  assert.equal(audienceLabel({ audience: { projectIds: ["a", "b", "c"] }, visibility: "members" }, roles, titles), "Team Falcon +2");
  assert.equal(audienceLabel({ audience: { projectIds: ["z"] }, visibility: "members" }, roles, new Map()), "Selected workspaces");
});

test("33.2 call 8: a company pin lasts up to 7 days", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  assert.equal(companyPinUntil(null, now).toISOString(), "2026-12-02T10:00:00.000Z", "no date: the full 7 days");
  assert.equal(companyPinUntil(new Date("2026-11-27T00:00:00Z"), now).toISOString(), "2026-11-27T00:00:00.000Z");
  assert.equal(companyPinUntil(new Date("2027-01-01T00:00:00Z"), now).toISOString(), "2026-12-02T10:00:00.000Z", "never past 7 days");
});
