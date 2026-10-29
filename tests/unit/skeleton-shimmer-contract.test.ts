import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("shared skeleton shimmer contract", async (t) => {
  const styles = read("src/app/globals.css");
  const primitive = read("src/components/ui/skeleton.tsx");
  const registry = read("src/components/workspaces/dashboard/WorkspaceTabsRegistry.tsx");

  await t.test("uses semantic neutral tokens and honors both motion preferences", () => {
    assert.match(primitive, /nb-skeleton/);
    assert.match(styles, /--skeleton-base/);
    assert.match(styles, /--skeleton-highlight/);
    assert.match(styles, /@keyframes nb-skeleton-shimmer/);
    assert.match(styles, /html\[data-reduce-motion="true"\] \.nb-skeleton[\s\S]*animation: none/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.nb-skeleton[\s\S]*animation: none/);
    assert.doesNotMatch(primitive, /zinc-|bg-primary|bg-accent/);
  });

  await t.test("all seven project tab fallbacks have a layout-matched loading surface", () => {
    for (const file of ["SkeletonDashboard", "SkeletonDoc", "SkeletonFiles", "SkeletonSprints", "SkeletonTasks", "SkeletonSettings", "SkeletonGitHubSync"]) {
      assert.ok(fs.existsSync(path.join(root, "src/components/workspaces/skeletons", `${file}.tsx`)), `${file} should exist`);
    }
    assert.match(registry, /SkeletonDashboard/);
    assert.match(registry, /SkeletonUpdates/);
    assert.doesNotMatch(registry, /animate-none/);
    assert.doesNotMatch(registry, /SkeletonAnalytics/);

    const sprintSkeleton = read("src/components/workspaces/skeletons/SkeletonSprints.tsx");
    assert.match(sprintSkeleton, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/);
    assert.match(sprintSkeleton, /border-r/);
    assert.match(sprintSkeleton, /aria-label="Loading sprints"/);
  });

  await t.test("keeps the Discovery route fallback aligned with its feed and people rail", () => {
    const hubPage = read("src/app/(site)/(main)/discover/loading.tsx");
    const hubSkeleton = read("src/components/discover/DiscoverRouteSkeleton.tsx");

    assert.match(hubPage, /DiscoverRouteSkeleton/);
    assert.match(hubSkeleton, /nb-discover-columns/);
    assert.match(hubSkeleton, /nb-discover-rail/);
    assert.match(hubSkeleton, /WorkspaceCardSkeleton/);
    assert.doesNotMatch(hubPage, /lg:grid-cols-3/);
  });

  await t.test("reuses one layout for tab-chunk and task or sprint data loading", () => {
    const tasksTab = read("src/components/workspaces/v2/TasksTab.tsx");
    const sprintsTab = read("src/components/workspaces/tabs/SprintPlanning.tsx");

    assert.match(tasksTab, /import \{ SkeletonTasks \}/);
    assert.match(tasksTab, /return <SkeletonTasks \/>;/);
    assert.match(sprintsTab, /import \{ SkeletonSprints \}/);
    assert.match(sprintsTab, /return <SkeletonSprints \/>;/);
  });

  await t.test("GitHub Sync subsystem uses unified layout-matched shimmer skeleton across all stages", () => {
    const gitHubSyncFile = read("src/components/workspaces/skeletons/SkeletonGitHubSync.tsx");
    const workspace = read("src/components/workspaces/v2/files-tab/RepositorySync.tsx");
    const filesTabMain = read("src/components/workspaces/v2/files-tab/FilesTabMain.tsx");

    assert.match(gitHubSyncFile, /import \{ Skeleton \} from "@\/components\/ui\/skeleton"/);
    assert.match(gitHubSyncFile, /role="status"/);
    assert.match(gitHubSyncFile, /aria-label="Loading repository sync"/);

    assert.match(filesTabMain, /import \{ SkeletonGitHubSync \}/);
    assert.match(filesTabMain, /loading:\s*\(\)\s*=>\s*<SkeletonGitHubSync/);
    assert.doesNotMatch(filesTabMain, /animate-pulse/);

    assert.match(workspace, /import \{ SkeletonGitHubSync \}/);
    assert.match(workspace, /import \{ Skeleton \} from "@\/components\/ui\/skeleton"/);
    assert.match(workspace, /<SkeletonGitHubSync/);
    assert.match(workspace, /aria-label="Comparing files"/);
    assert.match(workspace, /aria-label="Loading branches"/);
    assert.match(workspace, /aria-label="Loading accessible repositories"/);
    assert.match(workspace, /aria-label="Loading file comparison"/);
    assert.match(workspace, /aria-label="Loading diff"/);
  });
});
