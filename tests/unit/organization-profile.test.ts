import assert from "node:assert/strict";
import { test } from "node:test";

import { currentOrganizations, editorEntryStatus, entryStatus, groupProfileContributions, nestContributions, orgDiscoverable, orgDiscoverStatus, showKeeps } from "../../src/lib/organizations/profile-rules";
import { adminsCanSeeLine, joinPageState, ORG_JOIN_MESSAGES, privateOrgLine } from "../../src/lib/organizations/join-rules";

test("D7: a public org reaches Discover once it has a description and a workspace or a second member, or when verified", () => {
  const base = { verified: false, hasDescription: true, workspaces: 0, members: 1 };
  assert.equal(orgDiscoverable({ ...base, workspaces: 1 }), true, "description and a workspace");
  assert.equal(orgDiscoverable({ ...base, members: 2 }), true, "description and a second member");
  assert.equal(orgDiscoverable(base), false, "description only, nothing in it");
  assert.equal(orgDiscoverable({ ...base, hasDescription: false, workspaces: 3, members: 40 }), false, "no description");
  assert.equal(orgDiscoverable({ ...base, hasDescription: false, verified: true }), true, "verified always shows");
});

test("On Discover: the first state that applies, and which parts are missing", () => {
  const org = { verified: false, hasDescription: true, workspaces: 1, members: 2, visibility: "public", archived: false, deletionScheduledAt: null, suspended: false, discoverHidden: false };
  assert.deepEqual(orgDiscoverStatus(org), { state: "listed", verified: false });
  assert.deepEqual(orgDiscoverStatus({ ...org, visibility: "private" }), { state: "private" });
  assert.deepEqual(orgDiscoverStatus({ ...org, archived: true, suspended: true }), { state: "archived" });
  assert.deepEqual(orgDiscoverStatus({ ...org, deletionScheduledAt: "2026-12-01" }), { state: "deleting" });
  assert.deepEqual(orgDiscoverStatus({ ...org, suspended: true }), { state: "suspended" });
  assert.deepEqual(orgDiscoverStatus({ ...org, discoverHidden: true }), { state: "hidden" });
  assert.deepEqual(orgDiscoverStatus({ ...org, hasDescription: false, workspaces: 0, members: 1 }), { state: "waiting", parts: { description: false, content: false } });
  assert.deepEqual(orgDiscoverStatus({ ...org, hasDescription: false, workspaces: 0, members: 1, verified: true }), { state: "listed", verified: true });
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

test("26.9, decision 48: the private page tells each person their own state, and nothing from inside", () => {
  assert.deepEqual(privateOrgLine({ kind: "invited", role: "Student" }, "CSE 3B"), { line: "You’re invited as Student", join: false, action: "invite" });
  assert.deepEqual(privateOrgLine({ kind: "waiting" }, "CSE 3B"), { line: "Request sent", join: false, action: "cancel" });
  assert.equal(privateOrgLine({ kind: "left", date: "2 Nov" }, "CSE 3B").line, "You left CSE 3B on 2 Nov.");
  assert.deepEqual(privateOrgLine({ kind: "removed" }, "CSE 3B"), { line: "You’re no longer in CSE 3B.", join: true, action: null });
  assert.deepEqual(privateOrgLine({ kind: "blocked" }, "CSE 3B"), { line: "You can’t join this organization.", join: false, action: null });
  assert.equal(privateOrgLine({ kind: "ended" }, "CSE 3B").join, false);
  assert.deepEqual(privateOrgLine({ kind: "none" }, "CSE 3B"), { line: null, join: true, action: null });
});

test("16.10, 38.3: every editor row has a status", () => {
  const base = { id: "x", projectId: "x", projectKind: "organization" };
  assert.equal(editorEntryStatus({ ...base, publishedAt: "2026-10-01", visibility: "public", presentation: { visible: true } }), "Published");
  assert.equal(editorEntryStatus({ ...base, publishedAt: null }), "Draft");
  assert.equal(editorEntryStatus({ ...base, publishedAt: "2026-10-01", visibility: "private" }), "Hidden");
  assert.equal(editorEntryStatus({ ...base, endDate: "Nov 2026", endReason: "left", publishedAt: "2026-10-01" }), "Left");
  assert.equal(editorEntryStatus({ ...base, endReason: "removed", endDate: "Oct 2026" }), "Private to you");
});

test("26.2, gap 14: the join page knows every state, in order", () => {
  const base = { available: true, isMember: false, pending: false, blocked: false, declinedRecently: false, memberCount: 3, maxMembers: null, limit: null };
  assert.equal(joinPageState(base), "open");
  assert.equal(joinPageState({ ...base, isMember: true, blocked: true }), "member");
  assert.equal(joinPageState({ ...base, pending: true }), "waiting");
  assert.equal(joinPageState({ ...base, available: false }), "unavailable");
  assert.equal(joinPageState({ ...base, blocked: true }), "blocked");
  assert.equal(joinPageState({ ...base, declinedRecently: true }), "cooldown");
  assert.equal(joinPageState({ ...base, limit: "You’ve joined 50 organizations. Leave one to join this one." }), "limit");
  assert.equal(joinPageState({ ...base, memberCount: 40, maxMembers: 40 }), "full");
  assert.equal(ORG_JOIN_MESSAGES.no_match, "That code doesn’t work. Ask your organization for the current one.");
});

test("29.4, decision 63: the join page says what admins can see, in the organization's words", () => {
  assert.equal(adminsCanSeeLine("CSE 3B", { owner: "Teacher", admin: "TA" }),
    "CSE 3B’s Teachers and TAs can see your work here and when you were last active here. They can’t see your DMs or anything outside CSE 3B.");
});

test("27.9, decision 56: a badge is rechecked when the website or name changes", async () => {
  const { recheckVerification } = await import("@/lib/organizations/trust-rules");
  const byDomain = { verified: true, domain: "rvce.edu.in" };
  assert.equal(recheckVerification(byDomain, { websites: ["https://www.rvce.edu.in/cse"] }), "keep");
  assert.equal(recheckVerification(byDomain, { websites: ["https://cse3b.example.com"] }), "remove", "moved off the verified domain");
  assert.equal(recheckVerification(byDomain, { renamed: true }), "keep", "a rename keeps a domain badge");
  assert.equal(recheckVerification({ verified: true, domain: null }, { renamed: true }), "request_again", "a staff badge goes back to Requested");
  assert.equal(recheckVerification({ verified: false, domain: null }, { renamed: true }), "keep");
});
