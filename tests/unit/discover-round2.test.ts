import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("round 2: the projects route never fails open and varies on the session", () => {
  const route = read("src/app/api/v1/projects/route.ts");
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
  const project = read("src/app/actions/project/index.ts");
  const profile = read("src/app/actions/profile.ts");
  assert.doesNotMatch(project, /revalidateTag\(DISCOVER_ANON_CACHE_TAG, "max"\)/);
  assert.match(project, /revalidateTag\(DISCOVER_ANON_CACHE_TAG, \{ expire: 0 \}\)/);
  assert.match(profile, /invalidatePublicProjectsFeedCache\(\)/);
  assert.match(read("src/app/api/og/project/[slug]/route.tsx"), /s-maxage=3600/);
});

test("round 2: Escape in an open combobox closes its list, not the dialog", () => {
  assert.match(read("src/components/ui/dialog.tsx"), /getAttribute\("aria-expanded"\) === "true"\) event\.preventDefault\(\)/);
});
