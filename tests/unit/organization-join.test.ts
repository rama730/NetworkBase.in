import assert from "node:assert/strict";
import { test } from "node:test";

import { decideOrgJoin, generateJoinCode, normalizeJoinCode, type OrgJoinState } from "../../src/lib/organizations/join-rules";

// Report §6.1: 6 characters, uppercase letters and digits, no look-alikes (O/0, I/1).
test("join codes use the no-look-alike alphabet", () => {
  for (let i = 0; i < 2000; i += 1) {
    const code = generateJoinCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, code);
  }
});

test("typed codes are normalized; look-alikes and bad lengths are rejected", () => {
  assert.equal(normalizeJoinCode(" k7m-2qx "), "K7M2QX");
  assert.equal(normalizeJoinCode("K7M 2QX"), "K7M2QX");
  for (const raw of ["K7M2Q0", "K7M2QI", "K7M2Q", "K7M2QXX", "", "K7M2Q!"]) assert.equal(normalizeJoinCode(raw), null, raw);
});

const base: OrgJoinState = {
  available: true,
  isMember: false,
  isBlocked: false,
  joinMode: "instant",
  memberCount: 3,
  maxMembers: null,
  request: null,
};

test("join outcomes follow the org's state in a fixed order", () => {
  assert.equal(decideOrgJoin(base), "joined");
  assert.equal(decideOrgJoin({ ...base, joinMode: "approval" }), "requested");
  assert.equal(decideOrgJoin({ ...base, available: false, isMember: true }), "unavailable", "archived wins");
  assert.equal(decideOrgJoin({ ...base, isMember: true, isBlocked: true }), "already_member");
  assert.equal(decideOrgJoin({ ...base, isBlocked: true }), "blocked");
  assert.equal(decideOrgJoin({ ...base, maxMembers: 3 }), "full");
  assert.equal(decideOrgJoin({ ...base, joinMode: "approval", maxMembers: 3 }), "full", "full blocks requests too");
  assert.equal(decideOrgJoin({ ...base, memberCount: 2000 }), "full", "the platform cap applies without Max members");
  assert.equal(decideOrgJoin({ ...base, maxMembers: 5000, memberCount: 2000 }), "full", "Max members can only lower the cap");
});

test("approval mode respects a pending request and the decline cool-down", () => {
  const approval = { ...base, joinMode: "approval" as const };
  const now = Date.now();
  assert.equal(decideOrgJoin({ ...approval, request: { status: "pending", updatedAt: new Date(now), decidedBySelf: false } }), "already_requested");
  assert.equal(decideOrgJoin({ ...approval, request: { status: "rejected", updatedAt: new Date(now), decidedBySelf: false } }), "cooldown");
  assert.equal(decideOrgJoin({ ...approval, request: { status: "rejected", updatedAt: new Date(now), decidedBySelf: true } }), "requested", "withdrawing yourself is not a decline");
  assert.equal(decideOrgJoin({ ...approval, request: { status: "rejected", updatedAt: new Date(now - 60 * 24 * 3600 * 1000), decidedBySelf: false } }), "requested");
  assert.equal(decideOrgJoin({ ...base, request: { status: "pending", updatedAt: new Date(now), decidedBySelf: false } }), "joined", "instant mode admits a pending requester");
});
