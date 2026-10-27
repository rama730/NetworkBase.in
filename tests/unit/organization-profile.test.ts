import assert from "node:assert/strict";
import { test } from "node:test";

import { nestContributions, orgDiscoverable, showKeeps } from "../../src/lib/organizations/profile-rules";

test("new public orgs reach Discover after 3 members and 7 days, or when verified", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const week = new Date("2026-10-22T00:00:00Z");
  const fresh = new Date("2026-10-28T00:00:00Z");
  assert.equal(orgDiscoverable({ members: 3, createdAt: week, verifiedAt: null, now }), true);
  assert.equal(orgDiscoverable({ members: 2, createdAt: week, verifiedAt: null, now }), false);
  assert.equal(orgDiscoverable({ members: 50, createdAt: fresh, verifiedAt: null, now }), false);
  assert.equal(orgDiscoverable({ members: 1, createdAt: fresh, verifiedAt: fresh, now }), true);
});

test("Show keeps cards by kind and update cards only for Everything and Updates", () => {
  assert.deepEqual(showKeeps("all"), { projectKind: null, cards: true, updates: true });
  assert.deepEqual(showKeeps("organizations"), { projectKind: "organization", cards: true, updates: false });
  assert.deepEqual(showKeeps("projects"), { projectKind: "project", cards: true, updates: false });
  assert.deepEqual(showKeeps("updates"), { projectKind: null, cards: false, updates: true });
});

test("child project entries nest under their org's entry only when it is shown", () => {
  const entries = [
    { id: "c1", projectId: "lab", parentOrg: { id: "org" } },
    { id: "o", projectId: "org", projectKind: "organization" },
    { id: "c2", projectId: "quiz", parentOrg: { id: "other-org" } },
    { id: "p", projectId: "solo" },
  ];
  const nested = nestContributions(entries);
  assert.deepEqual(nested.map((e) => [e.id, e.children.map((c) => c.id)]), [["o", ["c1"]], ["c2", []], ["p", []]]);
});
