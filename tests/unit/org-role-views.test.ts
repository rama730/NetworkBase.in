import test from "node:test";
import assert from "node:assert/strict";

import { isWorkspaceTabVisibleToViewer, resolveAllowedWorkspaceTab } from "../../src/lib/workspaces/settings-policies";
import { orgSettingsSectionIds } from "../../src/lib/organizations/settings";

// Audit C4/C5 (2026-11-09): what each role sees in an organization, in one place. These are the rules the tab bar
// (WorkspaceLayout), the client (WorkspaceDashboardClient) and the server (workspace-route) all call.

const TABS = ["dashboard", "about", "readme", "updates", "sprints", "tasks", "files", "projects", "members", "settings"] as const;
type Viewer = { isOwnerOrMember: boolean; canManageSettings: boolean };
const ROLES: Record<"owner" | "admin" | "member" | "viewer" | "visitor", Viewer> = {
  owner: { isOwnerOrMember: true, canManageSettings: true },
  admin: { isOwnerOrMember: true, canManageSettings: true },
  member: { isOwnerOrMember: true, canManageSettings: false },
  // Viewers are in workspace_members, so they count as "in the org" for tabs; what they may do is narrower.
  viewer: { isOwnerOrMember: true, canManageSettings: false },
  visitor: { isOwnerOrMember: false, canManageSettings: false },
};
// A public org that shows its public tabs to visitors.
const PUBLIC = { readme: true, updates: true, sprints: true, tasks: true, files: true };

const visible = (v: Viewer) => TABS.filter((tabId) => isWorkspaceTabVisibleToViewer({ tabId, ...v, publicTabVisibility: PUBLIC, isOrganization: true }));

test("C4: each role's tabs in an organization", () => {
  assert.deepEqual(visible(ROLES.owner), [...TABS]);
  assert.deepEqual(visible(ROLES.admin), [...TABS]);
  // Members is the admins' roster; members reach people through the read-only list (decision D-A).
  assert.deepEqual(visible(ROLES.member), TABS.filter((t) => t !== "members"));
  assert.deepEqual(visible(ROLES.viewer), TABS.filter((t) => t !== "members"));
  // Visitors get About and the public tabs; never Overview, Workspaces, Members or Settings.
  assert.deepEqual(visible(ROLES.visitor), ["about", "readme", "updates", "sprints", "files"]);
});

test("C4: landing tab, and links to tabs a role can't open land somewhere real", () => {
  const land = (v: Viewer, requestedTab: string | null) => resolveAllowedWorkspaceTab({ requestedTab, ...v, publicTabVisibility: PUBLIC, isOrganization: true });
  assert.equal(land(ROLES.member, null), "dashboard");
  assert.equal(land(ROLES.visitor, null), "about");
  assert.equal(land(ROLES.member, "members"), "dashboard", "a member following ?tab=members lands on the Overview");
  assert.equal(land(ROLES.visitor, "settings"), "about");
  assert.equal(land(ROLES.admin, "members"), "members");
});

test("N39: an organization admin outside a child workspace's team can open its Settings", () => {
  // The client passes canManageSettings = the project's admin, or an inherited org admin (canOpenSettingsTab).
  const inheritedAdmin = { isOwnerOrMember: true, canManageSettings: true };
  assert.equal(isWorkspaceTabVisibleToViewer({ tabId: "settings", ...inheritedAdmin, isOrganization: false }), true);
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "settings", ...inheritedAdmin, isOrganization: false }), "settings");
});

test("C5: members and viewers open Settings on their own sections, Leave included", () => {
  for (const role of ["member", "viewer"] as const) {
    const ids = orgSettingsSectionIds(role);
    assert.deepEqual(ids, ["you-membership", "org-allowed", "privacy-policies", "org-management"], role);
  }
  assert.ok(orgSettingsSectionIds("admin").includes("org-profile"));
  assert.equal(orgSettingsSectionIds("owner")[0], "general");
});
