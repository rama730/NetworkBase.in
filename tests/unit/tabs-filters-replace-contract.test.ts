import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

// Unified back A2: switching a tab, filter, sort, sprint or settings section replaces the history
// entry, so back leaves the page in one step and comes back to the same tab or filter.
test("tab and filter changes replace history instead of pushing", () => {
  const dashboard = read("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");
  assert.match(dashboard, /window\.history\.replaceState\(keepStamp\(window\.history\.state\), '', nextUrl\)/);
  assert.doesNotMatch(dashboard, /window\.history\.pushState\(null, '', nextUrl\)/);

  const network = read("src/components/network/NetworkClient.tsx");
  assert.doesNotMatch(network, /router\.push\(\s*`\$\{ROUTES\.NETWORK\}/);

  const discover = read("src/hooks/discover/useDiscoverUrlFilters.ts");
  assert.doesNotMatch(discover, /pushState/);
  assert.doesNotMatch(read("src/components/discover/DiscoverClient.tsx"), /drawerPushed/);

  const inbox = read("src/components/trust/TrustInbox.tsx");
  assert.match(inbox, /setUrl\(changes as Record<string, string \| undefined>, true\)/);
  assert.doesNotMatch(read("src/components/trust/ConsoleHeader.tsx"), /pushState/);

  for (const file of ["src/components/workspaces/tabs/SprintPlanning.tsx", "src/components/workspaces/tabs/sprint/SprintLeftRail.tsx"]) {
    assert.doesNotMatch(read(file), /router\.push\(buildWorkspaceSprintDetailHref|router\.push\(href\(sprint\)\)/, file);
  }
  assert.doesNotMatch(read("src/hooks/useWorkspaceSettingsNavigation.ts"), /router\.push\(/);
  assert.doesNotMatch(read("src/components/workspaces/v2/files-tab/FilesViews.tsx"), /pushState/);
});

test("Files keeps folder and file history (user decision for R5)", () => {
  assert.match(read("src/components/workspaces/v2/files-tab/hooks/useFilesTabUrlSync.ts"), /push/);
});
