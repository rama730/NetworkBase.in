import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { ProjectAccess } from "../../src/lib/data/project-access";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
let canReadProjectTab: typeof import("../../src/lib/data/project-access").canReadProjectTab;
let computeProjectReadAccess: typeof import("../../src/lib/data/project-access").computeProjectReadAccess;
before(async () => ({ canReadProjectTab, computeProjectReadAccess } = await import("../../src/lib/data/project-access")));

function access(input: { visibility?: string; status?: string; owner?: boolean; member?: boolean; tabs?: Record<string, boolean> }): ProjectAccess {
  const isOwner = Boolean(input.owner);
  const isMember = Boolean(input.member);
  return {
    project: { id: "p", ownerId: "o", visibility: input.visibility ?? "public", status: input.status ?? "active", publicTabVisibility: input.tabs },
    isOwner,
    isMember,
    memberRole: isMember ? "member" : null,
    member: null,
    canRead: computeProjectReadAccess(input.visibility ?? "public", input.status ?? "active", isOwner, isMember),
    canWrite: isOwner,
  };
}

test("outsiders read a public active project's public tabs only", () => {
  const view = access({ tabs: { files: true, tasks: false, sprints: false, readme: true, updates: true, dashboard: true } });
  assert.equal(canReadProjectTab(view, "files"), true);
  assert.equal(canReadProjectTab(view, "tasks"), false);
  assert.equal(canReadProjectTab(view, "sprints"), false);
});

test("drafts, private projects and missing projects expose no tab to outsiders", () => {
  for (const view of [access({ status: "draft" }), access({ visibility: "private" }), { ...access({}), project: null, canRead: false }]) {
    for (const tab of ["dashboard", "readme", "updates", "files", "tasks", "sprints"] as const) {
      assert.equal(canReadProjectTab(view, tab), false, tab);
    }
  }
});

test("owners and members read every tab, including on drafts", () => {
  for (const view of [access({ owner: true, status: "draft", visibility: "private" }), access({ member: true, tabs: { tasks: false } })]) {
    assert.equal(canReadProjectTab(view, "tasks"), true);
    assert.equal(canReadProjectTab(view, "sprints"), true);
  }
});
