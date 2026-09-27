import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("shared skeleton shimmer contract", async (t) => {
  const styles = read("src/app/globals.css");
  const primitive = read("src/components/ui/skeleton.tsx");
  const registry = read("src/components/projects/dashboard/ProjectTabsRegistry.tsx");

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
    for (const file of ["SkeletonDashboard", "SkeletonDoc", "SkeletonFiles", "SkeletonSprints", "SkeletonTasks", "SkeletonSettings"]) {
      assert.ok(fs.existsSync(path.join(root, "src/components/projects/skeletons", `${file}.tsx`)), `${file} should exist`);
    }
    assert.match(registry, /SkeletonDashboard/);
    assert.match(registry, /SkeletonUpdates/);
    assert.doesNotMatch(registry, /animate-none/);
    assert.doesNotMatch(registry, /SkeletonAnalytics/);

    const sprintSkeleton = read("src/components/projects/skeletons/SkeletonSprints.tsx");
    assert.match(sprintSkeleton, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/);
    assert.match(sprintSkeleton, /border-r/);
    assert.match(sprintSkeleton, /aria-label="Loading sprints"/);
  });

  await t.test("keeps the Discovery route fallback aligned with its feed and people rail", () => {
    const hubPage = read("src/app/(main)/discover/page.tsx");
    const hubSkeleton = read("src/components/discover/DiscoverRouteSkeleton.tsx");

    assert.match(hubPage, /DiscoverRouteSkeleton/);
    assert.match(hubSkeleton, /nb-discover-columns/);
    assert.match(hubSkeleton, /nb-discover-rail/);
    assert.match(hubSkeleton, /ProjectCardSkeleton/);
    assert.doesNotMatch(hubPage, /lg:grid-cols-3/);
  });

  await t.test("reuses one layout for tab-chunk and task or sprint data loading", () => {
    const tasksTab = read("src/components/projects/v2/TasksTab.tsx");
    const sprintsTab = read("src/components/projects/tabs/SprintPlanning.tsx");

    assert.match(tasksTab, /import \{ SkeletonTasks \}/);
    assert.match(tasksTab, /return <SkeletonTasks \/>;/);
    assert.match(sprintsTab, /import \{ SkeletonSprints \}/);
    assert.match(sprintsTab, /return <SkeletonSprints \/>;/);
  });
});
