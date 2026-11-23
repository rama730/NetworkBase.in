import assert from "node:assert/strict";
import { test } from "node:test";

import { bugFieldsSchema, fixedGroups, openSeverityCounts, priorityForSeverity, severityGroups, triageOrder, whereLabel } from "../../src/lib/workflows/bugs";

// Report 38.6 part 7 (plan A2.1): the Bugs rules.
test("priorityForSeverity: Urgent → urgent, Major → high, Minor → medium, Not sure keeps priority", () => {
  assert.deepEqual(["urgent", "major", "minor", null].map((s) => priorityForSeverity(s as never)), ["urgent", "high", "medium", null]);
});

test("openSeverityCounts: New, Confirmed and Fixing count; Fixed and closed don't; Not sure separately", () => {
  const b = (stage: string, severity: string | null) => ({ stage, typeFields: { severity } });
  assert.deepEqual(openSeverityCounts([b("new", "urgent"), b("confirmed", "major"), b("fixing", "major"), b("fixed", "urgent"), b("wont_fix", "minor"), b("new", null)]),
    { urgent: 1, major: 2, minor: 0, notSure: 1 });
});

test("triageOrder: New only, oldest first, ties by more I see this too", () => {
  const b = (id: string, createdAt: string, seen: number, stage = "new") => ({ id, stage, createdAt, typeFields: { alsoSeen: Array.from({ length: seen }, (_, i) => `u${i}`) } });
  assert.deepEqual(triageOrder([b("c", "2026-11-03T10:00:00Z", 0), b("a", "2026-11-02T09:00:00Z", 1), b("b", "2026-11-02T09:00:00Z", 3), b("x", "2026-11-01T00:00:00Z", 9, "confirmed")]).map((x) => x.id), ["b", "a", "c"]);
});

test("whereLabel: web, app, other, missing version, nothing", () => {
  assert.equal(whereLabel({ kind: "web", browser: "Chrome", version: "131" }), "Web · Chrome 131");
  assert.equal(whereLabel({ kind: "app", platform: "iOS", version: "" }), "App · iOS");
  assert.equal(whereLabel({ kind: "other", text: "Printer" }), "Printer");
  assert.equal(whereLabel(null), null);
});

test("fixedGroups: Fixed and Verified by Fixed in, newest first, No version last", () => {
  const b = (id: string, stage: string, fixedIn: string | null, updatedAt: string) => ({ id, stage, updatedAt, typeFields: { fixedIn } });
  const groups = fixedGroups([b("1", "fixed", "v2.3", "2026-11-01"), b("2", "verified", "v2.4", "2026-11-05"), b("3", "fixed", null, "2026-11-06"), b("4", "fixing", "v2.5", "2026-11-07"), b("5", "fixed", "v2.4", "2026-11-04")]);
  assert.deepEqual(groups.map((g) => [g.name, g.bugs.map((x) => x.id)]), [["v2.4", ["2", "5"]], ["v2.3", ["1"]], ["No version", ["3"]]]);
});

test("severityGroups (Mine): Urgent · Major · Minor · Not sure, each by stage", () => {
  const b = (id: string, severity: string | null, stage: string) => ({ id, stage, typeFields: { severity } });
  assert.deepEqual(severityGroups([b("1", "minor", "new"), b("2", "urgent", "fixing"), b("3", "urgent", "confirmed"), b("4", null, "new")]).map((g) => [g.name, g.bugs.map((x) => x.id)]),
    [["Urgent", ["3", "2"]], ["Minor", ["1"]], ["Not sure", ["4"]]]);
});

test("bugFieldsSchema: known fields only, lengths capped, where shapes", () => {
  assert.ok(bugFieldsSchema.safeParse({ severity: "major", steps: "Open\\nClick", expected: "It works", where: { kind: "web", browser: "Firefox", version: "132" }, foundIn: "v2.3" }).success);
  assert.equal(bugFieldsSchema.safeParse({ severity: "huge" }).success, false);
  assert.equal(bugFieldsSchema.safeParse({ foundIn: "x".repeat(41) }).success, false);
  assert.equal(bugFieldsSchema.safeParse({ owner: "me" }).success, false);
});

test("a link to a workflow tab opens it for the workspace's own people only (A2.1 live check)", async () => {
  const { resolveAllowedWorkspaceTab } = await import("../../src/lib/workspaces/settings-policies");
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "bugs", isOwnerOrMember: true }), "bugs");
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "bugs", isOwnerOrMember: false }), "dashboard");
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "bugs", isOwnerOrMember: true, isOrganization: true }), "dashboard");
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "nonsense", isOwnerOrMember: true }), "dashboard");
});

// Report 38.6 part 7 (plan A2.2): duplicates.
test("resolveDuplicateTarget: walks to the open original; refuses self and loops", async () => {
  const { resolveDuplicateTarget } = await import("../../src/lib/workflows/bugs");
  const bugs = new Map([
    ["A", { stage: "new", duplicateOf: null }],
    ["B", { stage: "duplicate", duplicateOf: "C" }],
    ["C", { stage: "confirmed", duplicateOf: null }],
    ["D", { stage: "duplicate", duplicateOf: "A" }],
    ["E", { stage: "wont_fix", duplicateOf: null }],
  ]);
  assert.deepEqual(resolveDuplicateTarget("A", "B", bugs), { id: "C" }, "B is closed as a duplicate of C");
  assert.deepEqual(resolveDuplicateTarget("A", "A", bugs), { error: "A bug can’t be a duplicate of itself" });
  assert.deepEqual(resolveDuplicateTarget("A", "D", bugs), { error: "That bug is already a duplicate of this one" });
  assert.deepEqual(resolveDuplicateTarget("A", "E", bugs), { error: "Pick an open bug" });
  assert.deepEqual(resolveDuplicateTarget("A", "Z", bugs), { error: "Pick a bug in this workspace" });
});

test("mergeOnDuplicate: the source's reporter and see-too people join the target's, no repeats, capped at 500", async () => {
  const { mergeOnDuplicate } = await import("../../src/lib/workflows/bugs");
  assert.deepEqual(mergeOnDuplicate({ creatorId: "r1", alsoSeen: ["u1", "u2"] }, { creatorId: "r2", alsoSeen: ["u2", "u3"] }), ["u2", "u3", "r1", "u1"]);
  assert.deepEqual(mergeOnDuplicate({ creatorId: "r2", alsoSeen: [] }, { creatorId: "r2", alsoSeen: [] }), [], "the target's own reporter isn't added");
  const many = Array.from({ length: 499 }, (_, i) => `t${i}`);
  assert.equal(mergeOnDuplicate({ creatorId: "r1", alsoSeen: ["x", "y"] }, { creatorId: "r2", alsoSeen: many }).length, 500);
});
