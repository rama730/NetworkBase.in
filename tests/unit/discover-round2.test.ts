import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

const read = (path: string) => readFileSync(path, "utf8");

test("round 2: shared type and control classes sit in the components layer (utilities beside them win)", () => {
  const css = read("src/app/globals.css");
  const layered = [...css.matchAll(/@layer components \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join("\n");
  for (const rule of [".nb-meta {", ".nb-icon-button {", ".nb-card-title {", ".nb-tag {", ".nb-tab-count {", ".nb-compact {"]) {
    assert.ok(layered.includes(rule), `${rule} is inside @layer components`);
    // and not also defined outside a layer (which would beat utilities again)
    assert.equal(css.split(`\n${rule}`).length, 1, `${rule} has no unlayered copy`);
  }
  assert.match(css, /\.nb-icon-button\[aria-pressed="true"\]/);
});

test("round 2: the workspaces route never fails open and varies on the session", () => {
  const route = read("src/app/api/v1/workspaces/route.ts");
  assert.match(route, /return unavailable\('AUTH_UNAVAILABLE', error\)/);
  assert.doesNotMatch(route, /getViewerAuthContext\(\)\.catch\(\(\) => null\)/);
  assert.match(route, /Vary: 'Cookie, Authorization'/);
  // Every respond() is awaited inside the try, so a block-lookup failure reaches the fallback.
  assert.doesNotMatch(route, /\breturn respond\(/);
  assert.match(route, /forViewer\(page\.projects, viewerId\)/);
});

test("round 2: ranked feeds keep going, and the action says what went wrong", () => {
  const data = read("src/lib/data/discover.ts");
  const action = read("src/app/actions/discover.ts");
  assert.match(data, /buildSnapshotCursor\(filtersFingerprint, now, lastSnapshotItem\.id, consumedIndex - 1\)/);
  assert.match(data, /throw new StaleDiscoverFeedError\(\)/);
  assert.match(data, /cacheData\(snapshotKey, snapshot, 600\)/);
  assert.match(action, /code: 'STALE_FEED' as const/);
  assert.match(action, /input\.filters\.sort !== SORT_OPTIONS\.TRENDING \|\| input\.view === FILTER_VIEWS\.TRENDING/);
  assert.match(action, /!readLimit\.allowed && !readLimit\.degraded/);
  assert.match(action, /!user && !normalizedCursor && !normalizedSearch/);
});

test("round 2: caches drop a project or creator that goes private at once", () => {
  const project = projectActionsSource();
  const profile = read("src/app/actions/profile.ts");
  assert.doesNotMatch(project, /revalidateTag\(DISCOVER_ANON_CACHE_TAG, "max"\)/);
  assert.match(project, /revalidateTag\(DISCOVER_ANON_CACHE_TAG, \{ expire: 0 \}\)/);
  assert.match(profile, /invalidatePublicWorkspacesFeedCache\(\)/);
  assert.match(read("src/lib/sharing/social-image.tsx"), /private, no-store, no-cache, must-revalidate/);
});

test("round 2: Escape in an open combobox closes its list, not the dialog", () => {
  assert.match(read("src/components/ui/dialog.tsx"), /getAttribute\("aria-expanded"\) === "true"\) event\.preventDefault\(\)/);
});

test("round 2: one set of words for connection states, with correct plurals", async () => {
  const { CONNECTION_COPY } = await import("../../src/lib/connections/copy");
  assert.equal(CONNECTION_COPY.shared(1), "1 mutual connection");
  assert.equal(CONNECTION_COPY.shared(3), "3 mutual connections");
  for (const file of ["src/components/discover/DiscoverPeopleRail.tsx", "src/components/network/PersonCard.tsx"]) {
    assert.match(read(file), /CONNECTION_COPY\.(review|notAccepting)/, file);
  }
});

test("round 2: Connect sends once per click and a failure puts the row back at once", () => {
  const hook = read("src/hooks/useConnections.ts");
  const action = read("src/app/actions/connections.ts");
  assert.match(hook, /requestKeyFor\(variables\)/);
  assert.match(hook, /for \(const \[key, data\] of context\?\.previous \?\? \[\]\) queryClient\.setQueryData\(key, data\)/);
  assert.match(action, /namespace: 'connection-request'/);
  assert.match(action, /IdempotencyConflictError\) return \{ success: false/);
  assert.doesNotMatch(action, /Idempotency lock hit/);
  // People search preview: full key, validated first, first page only (COR-031); metadata only on discover (PERF-008).
  assert.match(action, /search:preview:people:v4:\$\{previewRevision\}:\$\{user\.id\}:b\$\{await blockVersion\(user\.id\)\}:\$\{requestShape\}/);
  assert.match(action, /const metadataPromise = tab !== 'discover' \? null/);
});

test("round 2: follow state stays true everywhere", () => {
  assert.match(projectActionsSource(), /relationship\?\.blockedByViewer \|\| relationship\?\.blockedByTarget/);
  assert.match(read("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), /queryKeys\.discover\.userFollowedProjects\(currentUserId\)/);
  assert.match(read("src/components/profile/v2/sections/WorkspacesGridCard.tsx"), /isFollowing=\{followed\.has\(cardProject\.id\)\}/);
  assert.match(read("src/hooks/mutations/useWorkspaceMutations.ts"), /query\.queryKey\[3\] === 'following'/);
});

test("round 2: keyboard focus shows everywhere (a tone, never a ring)", () => {
  const css = read("src/app/globals.css");
  // The tint lives in @layer base: a component's bg-* utility (a solid Button's fill) must win over it.
  const baseLayers = css.match(/@layer base \{[\s\S]*?\n\}/g) ?? [];
  assert.ok(baseLayers.some((block) => /:where\(a, button, summary, \[tabindex\]:not\(\[tabindex="-1"\]\)[^)]*\[role="treeitem"\], \[role="button"\]\):focus-visible \{\s*background-color: color-mix/.test(block)));
  const unlayered = css.replace(/@layer base \{[\s\S]*?\n\}/g, "");
  assert.doesNotMatch(unlayered, /:where\(a, button[^{]*\):focus-visible \{\s*background-color/);
  assert.match(css, /\[data-slot="button"\]:focus-visible \{\s*background-image:/);
  assert.match(css, /\.nb-person-connect:focus-visible \{ border-color:var\(--primary-active\)/);
  const picker = read("src/components/skills/SkillPicker.tsx");
  assert.doesNotMatch(picker, /role="tab"/);
  assert.equal(picker.match(/role="option"\s*\n\s*tabIndex=\{-1\}/g)?.length, 2);
});

test("round 2: one search field for Discover and Network; the top bar opens the one global search (2026-11-26)", () => {
  assert.match(read("src/components/discover/DiscoverHeader.tsx"), /<SearchField[\s\S]*?pageSearch/);
  assert.match(read("src/components/network/NetworkClient.tsx"), /<SearchField/);
  assert.doesNotMatch(read("src/components/layout/header/GlobalSearch.tsx"), /\[data-page-search\] input/);
  assert.match(read("src/components/layout/header/GlobalSearch.tsx"), /onClick=\{\(\) => onOpenCommandPalette\(query, context\)\}/);
});

test("round 2: legal links and the card avatar read cleanly", () => {
  const legal = read("src/components/legal/LegalLinks.tsx");
  assert.match(legal, /!showCopyright && className/);
  assert.match(legal, /suppressHydrationWarning/);
  assert.doesNotMatch(legal, /muted-foreground\/80/);
  assert.match(read("src/components/workspaces/WorkspaceAvatar.tsx"), /alt=\{size === "card" \? ""/);
});

test("round 2: cards get counts, not every role or member; filtered reads go through a cancellable GET", () => {
  const pub = read("src/lib/workspaces/public-feed-service.ts");
  assert.match(pub, /sum\(greatest\(\$\{workspaceOpenRoles\.count\} - \$\{workspaceOpenRoles\.filled\}, 0\)\)/);
  assert.match(pub, /lte\(rankedSub\.memberRank, 8\)/);
  assert.doesNotMatch(pub, /const roleRows = projectIds/);
  const data = read("src/lib/data/discover.ts");
  assert.match(data, /lte\(ranked\.memberRank, 8\)/);
  assert.match(data, /coalesce\(\$\{profiles\.visibility\}, 'public'\) = 'public' OR \$\{workspaceMembers\.userId\} = \$\{viewerId\}/);
  const route = read("src/app/api/v1/discover/workspaces/route.ts");
  assert.match(route, /jsonSuccess\(\{ projects: result\.projects/);
  assert.match(route, /status = result\.code === "RATE_LIMITED" \? 429/);
  assert.doesNotMatch(route, /export const /);
  const hook = read("src/hooks/discover/useDiscoverWorkspaces.ts");
  assert.match(hook, /\/api\/v1\/discover\/workspaces\?/);
  assert.match(hook, /queryFn: async \(\{ pageParam = undefined as string \| undefined, signal \}\)/);
});

test("round 2: following clears only its own project page", () => {
  const project = projectActionsSource();
  const follow = project.slice(project.indexOf("const revalidateProjectFollowers"), project.indexOf("const revalidateWorkspacePaths"));
  assert.doesNotMatch(follow, /PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG/);
});

test("discover card hydration reads a bounded team preview and summed open seats (PERF-012)", () => {
  const discover = readFileSync("src/lib/data/discover.ts", "utf8");
  assert.match(discover, /lte\(ranked\.memberRank, 8\)/);
  assert.match(discover, /count\(\*\) over \(partition by \$\{workspaceMembers\.projectId\}\)/);
  assert.match(discover, /sum\(greatest\(\$\{workspaceOpenRoles\.count\} - \$\{workspaceOpenRoles\.filled\}, 0\)\)/);
  assert.match(discover, /lte\(rankedConnectedMembers\.connectionRank, 3\)/);
});
