import assert from "node:assert/strict";
import { test } from "node:test";

import { orgSettingsSectionIds } from "../../src/lib/organizations/settings";
import { isProjectTabVisibleToViewer, resolveAllowedProjectTab } from "../../src/lib/projects/settings-policies";

// Report §18.3 (org tab bar by person) and §21.4 (who sees which settings sections).
const publicTabs = { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false };
const visible = (tabId: string, member: boolean, isOrganization = true) =>
  isProjectTabVisibleToViewer({ tabId, isOwnerOrMember: member, canManageSettings: false, publicTabVisibility: publicTabs, isOrganization });

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
  assert.equal(resolveAllowedProjectTab({ ...base }), "about");
  assert.equal(resolveAllowedProjectTab({ ...base, requestedTab: "dashboard" }), "about", "a hidden tab falls back to the landing tab");
  assert.equal(resolveAllowedProjectTab({ ...base, isOwnerOrMember: true }), "dashboard");
  assert.equal(resolveAllowedProjectTab({ ...base, isOwnerOrMember: true, requestedTab: "about" }), "about");
  assert.equal(resolveAllowedProjectTab({ isOwnerOrMember: false, publicTabVisibility: publicTabs, requestedTab: "about" }), "dashboard", "no About outside orgs");
});

test("settings sections by org role", () => {
  const owner = orgSettingsSectionIds("owner");
  const admin = orgSettingsSectionIds("admin");
  assert.deepEqual(orgSettingsSectionIds("member"), ["you-membership", "you-leave"]);
  assert.deepEqual(orgSettingsSectionIds("viewer"), ["you-membership", "you-leave"]);
  for (const id of ["org-profile", "org-access", "org-people", "org-projects", "general", "danger"]) assert.ok(owner.includes(id), id);
  assert.ok(admin.includes("org-people"), "admins read the people section");
  for (const id of ["general", "danger"]) assert.ok(!admin.includes(id), id);
  for (const ids of [owner, admin]) assert.ok(!ids.includes("roles-applications"), "orgs have no open roles");
  assert.equal(owner[0], "you-membership", "You group first");
});

test("Members is for org owners and admins only (report §20.8)", () => {
  const managers = { tabId: "members", isOwnerOrMember: true, publicTabVisibility: publicTabs, isOrganization: true };
  assert.equal(isProjectTabVisibleToViewer({ ...managers, canManageSettings: true }), true);
  assert.equal(isProjectTabVisibleToViewer({ ...managers, canManageSettings: false }), false, "members and guests");
  assert.equal(isProjectTabVisibleToViewer({ ...managers, canManageSettings: true, isOrganization: false }), false, "not in normal projects");
  assert.equal(resolveAllowedProjectTab({ ...managers, requestedTab: "members", canManageSettings: true }), "members");
  assert.equal(resolveAllowedProjectTab({ ...managers, requestedTab: "members", canManageSettings: false }), "dashboard");
});

test("Projects is for people in the org (report §28.5)", () => {
  assert.equal(visible("projects", true), true);
  assert.equal(visible("projects", false), false, "visitors see public projects on About");
  assert.equal(visible("projects", true, false), false, "not in normal projects");
});
