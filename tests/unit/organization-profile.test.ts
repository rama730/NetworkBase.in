import assert from "node:assert/strict";
import { test } from "node:test";

import { currentOrganizations, entryStatus, groupProfileContributions, nestContributions, orgDiscoverable, showKeeps } from "../../src/lib/organizations/profile-rules";

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
  assert.deepEqual(showKeeps("projects"), { projectKind: "workspace", cards: true, updates: false });
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

test("4.5, decision 13: the Organizations section lists current organizations in the person's order", () => {
  const e = (id: string, extra: Record<string, unknown>) => ({ id, projectId: id, projectKind: "organization", projectTitle: id, ...extra });
  const list = [e("b", { profileOrder: 1 }), e("a", { profileOrder: 0 }), e("left", { endDate: "Nov 2026", endReason: "left" }), e("hidden", { showOnProfile: false }), e("ws", { projectKind: "workspace" })];
  assert.deepEqual(currentOrganizations(list, false).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(currentOrganizations(list, true).map((x) => x.id), ["a", "b", "hidden"]);
});

test("4.5, 16.9: contributions split into organizations and workspaces; your own view adds drafts and private entries", () => {
  const list = [
    { id: "org", projectId: "org", projectKind: "organization", publishedAt: "2026-10-01" },
    { id: "child", projectId: "child", projectKind: "workspace", parentOrg: { id: "org" }, publishedAt: "2026-10-01" },
    { id: "ws", projectId: "ws", projectKind: "workspace", publishedAt: "2026-10-01" },
    { id: "draft", projectId: "d", projectKind: "organization", publishedAt: null },
    { id: "gone", projectId: "g", projectKind: "organization", endReason: "removed", endDate: "Oct 2026", publishedAt: "2026-09-01" },
  ];
  const mine = groupProfileContributions(list, true);
  assert.deepEqual(mine.organizations.map((x) => [x.id, x.children.map((c) => c.id)]), [["org", ["child"]]]);
  assert.deepEqual(mine.workspaces.map((x) => x.id), ["ws"]);
  assert.deepEqual(mine.drafts.map((x) => x.id), ["draft"]);
  assert.deepEqual(mine.privateToYou.map((x) => x.id), ["gone"]);
  const theirs = groupProfileContributions(list, false);
  assert.deepEqual([theirs.drafts.length, theirs.privateToYou.length], [0, 0]);
  assert.equal(entryStatus({ id: "x", projectId: "x", endReason: "term_ended" }), "Completed");
  assert.equal(entryStatus({ id: "x", projectId: "x", endDate: "Nov 2026", endReason: null }), "Left", "old endings read as Left");
  assert.equal(entryStatus({ id: "x", projectId: "x" }), null);
});
