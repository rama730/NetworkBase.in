import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectActionsSource } from "./_workspace-actions-source";

const ROOT = process.cwd();

test("Domain A: Pruned 13 redundant indexes from schema/index.ts", () => {
  const schemaContent = readFileSync(resolve(ROOT, "src/lib/db/schema/index.ts"), "utf-8");

  // Pruned redundant indexes must NOT be present
  assert.doesNotMatch(schemaContent, /index\("idx_project_members_project"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_project_follows_project_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("workspace_open_roles_workspace_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("tasks_workspace_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("tasks_deleted_at_partial_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("workspace_sprints_workspace_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_task_subtasks_task_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_task_comments_task_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("idx_project_nodes_project_id"\)/);
  assert.doesNotMatch(schemaContent, /index\("workspace_nodes_path_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_markdowns_project_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("project_updates_covering_feed_idx"\)/);
  assert.doesNotMatch(schemaContent, /index\("workspaces_created_at_idx"\)/);

  // Covering composite or unique indexes MUST be present
  assert.match(schemaContent, /projectUserUnique:\s*uniqueIndex/);
  assert.match(schemaContent, /uniqueFollow:\s*uniqueIndex/);
  assert.match(schemaContent, /projectUpdatedIdx:\s*index/);
  assert.match(schemaContent, /projectStatusIdx:\s*index/);
  assert.match(schemaContent, /projectNumberIdx:\s*uniqueIndex/);
  assert.match(schemaContent, /taskPositionIdx:\s*index/);
  assert.match(schemaContent, /createdAtIdx:\s*index/);
  assert.match(schemaContent, /listingIdx:\s*index/);
  assert.match(schemaContent, /projectSlugUnique:\s*uniqueIndex/);
  assert.match(schemaContent, /publicFeedIdx:\s*index/);
  assert.match(schemaContent, /createdAtStatusIdx:\s*index/);
});

test("Domain B: task search matches title, description and key inside one project", () => {
  const actionsContent = projectActionsSource();

  // Spec: search covers the description too. The scan stays bounded by the workspace_id predicate.
  assert.match(actionsContent, /ilike\(t\.title,\s*searchPattern\),\s*ilike\(t\.description,\s*searchPattern\)/);
  assert.match(actionsContent, /eq\(t\.projectId, projectId\),\s*isNull\(t\.deletedAt\)/);
});

test("Domain B: fetchProjectTasksForActor skips 4-table count CTE when surface is preview", () => {
  const actionsContent = projectActionsSource();

  assert.match(actionsContent, /const countRows = taskIds\.length === 0 \|\| surface === "preview"/);
});

test("Domain B: resolveWorkspaceDetailTarget joins owner profile to eliminate shell waterfall", () => {
  const actionsContent = projectActionsSource();

  assert.match(actionsContent, /alias\(profiles,\s*"project_detail_owner_profiles"\)/);
  assert.match(actionsContent, /prefetchedOwner\?:/);
});

test("Domain C: Eliminates stats_invalidate broadcast storm loop", () => {
  const clientContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(clientContent, /stats_invalidate/);
  assert.doesNotMatch(clientContent, /statsChannelRef/);
  assert.doesNotMatch(clientContent, /subscribeProjectStats/);

  assert.match(clientContent, /const nextViews = payload\.view_count;/);
  assert.match(clientContent, /const nextFollowers = payload\.followers_count;/);
});

test("Domain D: Scopes refreshProjectData invalidation to active tabs", () => {
  const clientContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"),
    "utf-8"
  );

  assert.match(clientContent, /const targetTab = scopeTab \|\| activeTab;/);
  assert.match(clientContent, /tasks: targetTab === .tasks. \|\| targetTab === .dashboard./);
  assert.match(clientContent, /sprints: targetTab === .sprints./);
});

test("Domain D: DocTab loads the document and its list in one request", () => {
  const docTabContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/tabs/DocTab.tsx"),
    "utf-8"
  );

  assert.match(docTabContent, /const paramDoc = searchParams\?\.get\("doc"\);/);
  assert.doesNotMatch(docTabContent, /useWorkspaceDocList/);
  assert.match(docTabContent, /useWorkspaceDoc\(projectId, paramDoc \? normalizeWorkspaceDocSlug\(paramDoc\) : null\)/);
});

test("Domain D: useWorkspaceMembers configures gcTime for memory cleanup", () => {
  const hookContent = readFileSync(
    resolve(ROOT, "src/hooks/workspaces/useWorkspaceMembers.ts"),
    "utf-8"
  );

  assert.match(hookContent, /gcTime: 1000 \* 60 \* 10/);
});

test("Domain E: WorkspaceLayout eliminates forced layout reflow from getBoundingClientRect", () => {
  const layoutContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(layoutContent, /tabsRef\.current\?\.getBoundingClientRect\(\)\.height/);
  assert.match(layoutContent, /entries\[0\]\?\.contentRect/);
  assert.match(layoutContent, /z-30 shrink-0 border-b border-border bg-card/);
});

test("Domain E: JourneyTimeline isolates card stacking context to prevent sticky header scroll overlap", () => {
  const journeyContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/dashboard/JourneyTimeline.tsx"),
    "utf-8"
  );

  assert.match(journeyContent, /<RailSection\s+title="Stages"\s+className="isolate"/);
  assert.doesNotMatch(journeyContent, /className="[^"]*\bz-10\b[^"]*"[^>]*data-stage-index/);
});

test("Domain E: WorkspaceStatsBar renders both project metrics without legacy icon imports", () => {
  const statsBarContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/WorkspaceStatsBar.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(statsBarContent, /\bBookmark\b/);
  assert.match(statsBarContent, /import { BarChart2, UsersRound } from "lucide-react";/);
  assert.match(statsBarContent, /follower-count/);
});

test("Domain E: ProjectOverviewCard memoizes StatementBox and click handlers", () => {
  const overviewContent = readFileSync(
    resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceOverviewCard.tsx"),
    "utf-8"
  );

  assert.match(overviewContent, /const StatementBox = memo\(function StatementBox/);
  assert.match(overviewContent, /handleOpenProblem = useCallback/);
  assert.match(overviewContent, /handleOpenSolution = useCallback/);
});

test("Domain G: Project page route consolidates viewer identity context", () => {
  const pageContent = readFileSync(
    resolve(ROOT, "src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx"),
    "utf-8"
  );

  assert.doesNotMatch(pageContent, /getViewerAuthContext/);
  assert.match(pageContent, /getViewerIdentityContext/);
  assert.match(pageContent, /const { result } = await readProjectRouteShell\(slug\);/);
  assert.match(pageContent, /const sprintPromise = selectedTab === "sprints"/);
});
