import assert from "node:assert/strict";
import test from "node:test";

import { activityMatches } from "@/lib/organizations/activity-rules";
import { serverFirst } from "@/lib/server-first";

// Phase 1 of the live-fix plan (problem 1): a browser tab runs server actions one at a time, so an organization tab
// starts its main read on the server and uses that, once, instead of queueing a call of its own.

test("serverFirst hands back the read the server started, once; every later call loads afresh", async () => {
  let loads = 0;
  const read = serverFirst(Promise.resolve("from the page"), async () => `load ${++loads}`);
  assert.equal(await read(), "from the page");
  assert.equal(await read(), "load 1");
  assert.equal(await read(), "load 2");
});

test("serverFirst without a started read just loads", async () => {
  const read = serverFirst(null, async () => "loaded");
  assert.equal(await read(), "loaded");
});

test("the Overview's activity filter runs in the browser, matching the server's kinds", () => {
  assert.equal(activityMatches("all", "sprint"), true);
  assert.equal(activityMatches("assignments", "assignment"), true);
  assert.equal(activityMatches("assignments", "submission"), true);
  assert.equal(activityMatches("assignments", "joins"), false);
  assert.equal(activityMatches("people", "joins"), true);
  assert.equal(activityMatches("files", "file"), true);
  assert.equal(activityMatches("files", "doc"), true);
  assert.equal(activityMatches("projects", "project"), true);
  assert.equal(activityMatches("projects", "file"), false);
});

import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("the page starts an organization tab's first reads on the server and the tabs use them", () => {
  const route = read("src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx");
  assert.match(route, /orgStarted=\{orgStarted\}/);
  assert.match(route, /readOrgDashboardAction\(orgId\)/);
  assert.match(route, /readOrgMembersAction\(orgId\)/);
  const client = read("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");
  assert.match(client, /started=\{orgStarted\?\.dashboard\}/);
  assert.match(client, /started=\{orgStarted\?\.members\}/);
  assert.match(client, /useRoleApplicationCounts\(project\.id, canManageProjectSettings && !isOrganization\)/);
});

test("the sidebar's own reads ride the shell batch and never show 'No workspaces yet' while loading (problem 2)", () => {
  const sidebar = read("src/components/layout/AppSidebar.tsx");
  assert.match(sidebar, /readShellPart\("sidebarWorkspaces"\)\) \?\? null/);
  assert.match(sidebar, /readShellPart\("staffBadge"\)\) \?\? null/);
  assert.match(sidebar, /projectsQuery\.isPending \|\| workspacesQuery\.isPending/);
  assert.doesNotMatch(sidebar, /isStaff && staffBadge\.data \?/);
  const shell = read("src/app/actions/shell.ts");
  assert.match(shell, /sidebarWorkspaces: readSidebarWorkspacesAction/);
  assert.match(shell, /staffBadge: staffBadgeAction/);
  assert.match(read("src/app/(site)/(main)/layout.tsx"), /initialProfile=\{initialProfile\}/);
});

import { offerStartedRoot, takeStartedRoot } from "@/lib/files/started-root";

test("the Files explorer takes the page's started root read once, for that project only", async () => {
  offerStartedRoot("p1", Promise.resolve({ success: true } as never));
  assert.equal(takeStartedRoot("p2"), null);
  assert.deepEqual(await takeStartedRoot("p1"), { success: true });
  assert.equal(takeStartedRoot("p1"), null);
  offerStartedRoot("p1", null);
  assert.equal(takeStartedRoot("p1"), null);
});

import { formatInZone } from "@/lib/organizations/zoned-time";

test("dates the server renders use the organization's zone (or UTC), so the browser draws the same text (#418)", () => {
  const lateOct = "2026-10-31T20:00:00Z";
  assert.equal(formatInZone(lateOct, { month: "short", year: "numeric" }, "Asia/Kolkata"), "Nov 2026");
  assert.equal(formatInZone(lateOct, { month: "short", year: "numeric" }, null), "Oct 2026");
  assert.equal(formatInZone(lateOct, { month: "short", year: "numeric" }, "Not/AZone"), "Oct 2026");
});
