import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectActionsSource } from "./_project-actions-source";

const source = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("project detail has an immediate route shell and a shared server read", () => {
  const page = source("src/app/(site)/(main)/projects/[slug]/project-route.tsx");
  const loading = source("src/app/(site)/(main)/projects/[slug]/loading.tsx");

  assert.match(page, /const readProjectRouteShell = cache/);
  assert.match(page, /readProjectRouteShell\(slug\)/);
  assert.match(page, /getViewerIdentityContext\(\)/);
  assert.doesNotMatch(page, /readProjectDetailMetadata/);
  assert.match(loading, /aria-label="Loading project"/);
});

test("project cards use one native route-prefetch path", () => {
  const card = source("src/components/projects/ProjectCard.tsx");

  assert.doesNotMatch(card, /prefetch=\{false\}/);
  assert.doesNotMatch(card, /useRouteWarmPrefetch/);
});

test("project detail defers and deduplicates optional work", () => {
  const dashboard = source("src/components/projects/dashboard/ProjectDashboardClient.tsx");
  const actions = projectActionsSource();

  assert.match(dashboard, /const guidance = \(project as \{ guidance\?: unknown \}\)\.guidance \?\? null/);
  assert.match(actions, /const \[ownerRows, followersResult, membersResult, rolesResult, readmeRows, guidanceRows\] =/);
  assert.match(actions, /guidance: shell\.guidance \?\? null/);
  assert.match(dashboard, /sessionStorage\.getItem\(sessionKey\)/);
  assert.match(dashboard, /requestIdleCallback\(incrementView, \{ timeout: 10_000 \}\)/);
});

test("project shell overlaps independent enrichment reads and records its latency", () => {
  const actions = projectActionsSource();

  assert.match(actions, /const \[acceptedRoleRows, ownerRelationship\] = await Promise\.all\(/);
  assert.match(actions, /logger\.metric\("project\.detail\.shell\.data"/);
});
