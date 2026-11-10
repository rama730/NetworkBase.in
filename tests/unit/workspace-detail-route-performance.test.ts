import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

const source = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("project detail has an immediate route shell and a shared server read", () => {
  const page = source("src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx");
  const loading = source("src/app/(site)/(main)/workspaces/[slug]/loading.tsx");

  assert.match(page, /const readProjectRouteShell = cache/);
  assert.match(page, /readProjectRouteShell\(slug\)/);
  assert.match(page, /getViewerIdentityContext\(\)/);
  assert.doesNotMatch(page, /readWorkspaceDetailMetadata/);
  assert.match(loading, /aria-label="Loading workspace"/);
});

test("scrolling past project cards fetches no pages; pointing at one prefetches it", () => {
  const card = source("src/components/workspaces/WorkspaceCard.tsx");

  // Off until someone hovers, touches or tabs to the card (Next's hover-prefetch pattern), then the full page.
  assert.match(card, /<Link prefetch=\{intent \? true : false\} onMouseEnter=\{showIntent\} onTouchStart=\{showIntent\} onFocus=\{showIntent\} href=\{href\}/);
  assert.match(card, /const \[intent, setIntent\] = useState\(false\)/);
  assert.doesNotMatch(card, /useRouteWarmPrefetch/);
});

test("a workspace open starts its always-visible reads on the server (no queue of server actions)", () => {
  const route = source("src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx");
  assert.match(route, /lastUpdate: getWorkspaceLastUpdates\(\{ projectIds: \[project\.id\] \}\)/);
  assert.match(route, /recentActivity: readWorkspaceRecentActivityAction\(project\.id\)/);
  assert.match(route, /roleCounts: getRoleApplicationCountsAction\(project\.id\)/);
  assert.match(route, /started=\{started\}/);
  // Only link-preview bots read the share preview in metadata.
  assert.match(route, /const preview = crawler \? await readSharePreview\(url\) : null;/);
  for (const file of ["src/components/workspaces/WorkspaceLastUpdate.tsx", "src/components/workspaces/dashboard/RecentActivityCard.tsx", "src/hooks/useRoleApplicationCounts.ts"]) {
    assert.match(source(file), /serverFirst\(started, /, file);
  }
});

test("project detail defers and deduplicates optional work", () => {
  const dashboard = source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");
  const actions = projectActionsSource();

  assert.match(dashboard, /const guidance = \(project as \{ guidance\?: unknown \}\)\.guidance \?\? null/);
  assert.match(actions, /const \[ownerRows, followersResult, membersResult, rolesResult, readmeRows, guidanceRows\] =/);
  assert.match(actions, /guidance: shell\.guidance \?\? null/);
  // Counting a view waits for 3 visible seconds and is sent once per browser session.
  const liveCounts = source("src/hooks/useWorkspaceLiveCounts.ts");
  assert.match(dashboard, /useWorkspaceViewBeacon\(project\?\.id, canSeeAllTabs\)/);
  assert.match(liveCounts, /sessionStorage\.getItem\(sessionKey\)/);
  assert.match(liveCounts, /startVisibleDwell\(VIEW_DWELL_MS/);
});

test("project shell overlaps independent enrichment reads and records its latency", () => {
  const actions = projectActionsSource();

  assert.match(actions, /const \[acceptedRoleRows, ownerRelationship\] = await Promise\.all\(/);
  assert.match(actions, /logger\.metric\("project\.detail\.shell\.data"/);
});
