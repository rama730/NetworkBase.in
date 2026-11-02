import assert from "node:assert/strict";
import { test } from "node:test";

import { orgSettingsSectionIds } from "../../src/lib/organizations/settings";
import { isWorkspaceTabVisibleToViewer, resolveAllowedWorkspaceTab } from "../../src/lib/workspaces/settings-policies";

// Report §18.3 (org tab bar by person) and §21.4 (who sees which settings sections).
const publicTabs = { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false };
const visible = (tabId: string, member: boolean, isOrganization = true) =>
  isWorkspaceTabVisibleToViewer({ tabId, isOwnerOrMember: member, canManageSettings: false, publicTabVisibility: publicTabs, isOrganization });

test("org visitors see About and the public tabs; never Dashboard, Tasks or Settings", () => {
  for (const tab of ["about", "updates", "readme", "files"]) assert.equal(visible(tab, false), true, tab);
  for (const tab of ["dashboard", "tasks", "settings", "sprints"]) assert.equal(visible(tab, false), false, tab);
});

test("everyone in the org sees every tab, Settings included (their You sections)", () => {
  for (const tab of ["dashboard", "about", "updates", "readme", "sprints", "tasks", "files", "settings"]) assert.equal(visible(tab, true), true, tab);
});

test("normal projects have no About tab and keep Settings for managers", () => {
  assert.equal(visible("about", true, false), false);
  assert.equal(visible("settings", true, false), false);
});

test("visitors land on About, people in the org on Dashboard", () => {
  const base = { isOwnerOrMember: false, publicTabVisibility: publicTabs, isOrganization: true };
  assert.equal(resolveAllowedWorkspaceTab({ ...base }), "about");
  assert.equal(resolveAllowedWorkspaceTab({ ...base, requestedTab: "dashboard" }), "about", "a hidden tab falls back to the landing tab");
  assert.equal(resolveAllowedWorkspaceTab({ ...base, isOwnerOrMember: true }), "dashboard");
  assert.equal(resolveAllowedWorkspaceTab({ ...base, isOwnerOrMember: true, requestedTab: "about" }), "about");
  assert.equal(resolveAllowedWorkspaceTab({ isOwnerOrMember: false, publicTabVisibility: publicTabs, requestedTab: "about" }), "dashboard", "no About outside orgs");
});

test("settings sections by org role (report §22.3)", () => {
  const owner = orgSettingsSectionIds("owner");
  const admin = orgSettingsSectionIds("admin");
  assert.deepEqual(orgSettingsSectionIds("member"), ["you-membership", "org-allowed", "privacy-policies", "org-management"]);
  assert.deepEqual(orgSettingsSectionIds("viewer"), orgSettingsSectionIds("member"));
  assert.deepEqual(owner, admin, "admins see every section; some fields are read only");
  assert.equal(owner[0], "general", "owners and admins open on Details");
  for (const id of ["org-profile", "org-access", "org-people", "org-projects", "org-work", "org-updates", "org-messages", "org-storage", "org-moderation", "org-management"]) assert.ok(owner.includes(id), id);
  for (const id of ["roles-applications", "collaborators", "tasks-workflow", "files-workspace", "danger"]) assert.ok(!owner.includes(id), `${id} isn't an organization section`);
});

test("Members is for org owners and admins only (report §20.8)", () => {
  const managers = { tabId: "members", isOwnerOrMember: true, publicTabVisibility: publicTabs, isOrganization: true };
  assert.equal(isWorkspaceTabVisibleToViewer({ ...managers, canManageSettings: true }), true);
  assert.equal(isWorkspaceTabVisibleToViewer({ ...managers, canManageSettings: false }), false, "members and guests");
  assert.equal(isWorkspaceTabVisibleToViewer({ ...managers, canManageSettings: true, isOrganization: false }), false, "not in normal projects");
  assert.equal(resolveAllowedWorkspaceTab({ ...managers, requestedTab: "members", canManageSettings: true }), "members");
  assert.equal(resolveAllowedWorkspaceTab({ ...managers, requestedTab: "members", canManageSettings: false }), "dashboard");
});

test("Projects is for people in the org (report §28.5)", () => {
  assert.equal(visible("projects", true), true);
  assert.equal(visible("projects", false), false, "visitors see public projects on About");
  assert.equal(visible("projects", true, false), false, "not in normal projects");
});
