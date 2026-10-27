import assert from "node:assert/strict";
import { test } from "node:test";

import { filterRoster, memberChangeBlock, memberStatus, parseInviteEmails, workSummary, type RosterRow } from "../../src/lib/organizations/member-rules";

test("work counts skip excused copies; Behind means something is missing; Inactive after 14 days", () => {
  assert.deepEqual(workSummary(["done", "done", "missing", "excused", "in_progress"]), { done: 2, total: 4, missing: 1 });
  const now = new Date("2026-10-30T00:00:00Z");
  assert.deepEqual(memberStatus({ missing: 1, lastActiveAt: new Date("2026-10-29T00:00:00Z"), now }), { behind: true, inactive: false });
  assert.deepEqual(memberStatus({ missing: 0, lastActiveAt: new Date("2026-10-10T00:00:00Z"), now }), { behind: false, inactive: true });
  assert.equal(memberStatus({ missing: 0, lastActiveAt: null, now }).inactive, true);
});

test("only the owner manages admins; nobody changes the owner here", () => {
  assert.equal(memberChangeBlock("admin", "member", "viewer"), null);
  assert.equal(memberChangeBlock("admin", "viewer", null), null, "admins remove guests");
  assert.match(memberChangeBlock("admin", "member", "admin") ?? "", /Only the owner/);
  assert.match(memberChangeBlock("admin", "admin", null) ?? "", /Only the owner/);
  assert.equal(memberChangeBlock("owner", "admin", "member"), null);
  assert.match(memberChangeBlock("owner", "owner", null) ?? "", /Transfer ownership/);
  assert.match(memberChangeBlock("member", "viewer", null) ?? "", /owners and admins/);
});

test("pasted emails are split, normalized, de-duplicated and checked", () => {
  assert.deepEqual(parseInviteEmails("Asha@x.edu, ravi@x.edu\n<meena@x.edu>; asha@x.edu  not-an-email"), {
    valid: ["asha@x.edu", "ravi@x.edu", "meena@x.edu"],
    invalid: ["not-an-email"],
  });
});

test("roster filters and sorts: role, project, Not in a project, Behind first", () => {
  const row = (name: string, extra: Partial<RosterRow>): RosterRow => ({ userId: name, name, role: "member", title: null, projects: [], work: { done: 0, total: 0, missing: 0 }, lastActiveAt: null, joinedAt: null, behind: false, inactive: false, ...extra });
  const rows = [
    row("Asha", { projects: [{ id: "p1", title: "Compiler Lab", unit: "Frontend" }], work: { done: 8, total: 10, missing: 1 }, behind: true }),
    row("Kiran", { role: "admin", title: "TA" }),
    row("Meena", { role: "viewer", work: { done: 0, total: 2, missing: 2 }, behind: true }),
  ];
  assert.deepEqual(filterRoster(rows, { role: "admins" }).map((r) => r.name), ["Kiran"]);
  assert.deepEqual(filterRoster(rows, { project: "none" }).map((r) => r.name), ["Kiran", "Meena"]);
  assert.deepEqual(filterRoster(rows, { project: "p1" }).map((r) => r.name), ["Asha"]);
  assert.deepEqual(filterRoster(rows, { status: "behind", sort: "behind" }).map((r) => r.name), ["Meena", "Asha"]);
  assert.deepEqual(filterRoster(rows, { q: "ta" }).map((r) => r.name), ["Kiran"]);
});
