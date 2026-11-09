import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const PAGE = "src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx";
const PDC = "src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx";

test("the viewer's role comes from the server capabilities, not the first members page", () => {
  assert.match(read(PAGE), /memberRole=\{capabilities\.memberRole\}/);
  const client = read(PDC);
  assert.match(client, /normalizeWorkspaceMemberRole\(memberRole, 'member'\)/);
  assert.doesNotMatch(client, /allMembers\.find\([^)]*\)\s*;\s*return member \? normalizeWorkspaceMemberRole/);
});

test("the canonical slug redirect keeps repeated params repeated", () => {
  const page = read(PAGE);
  assert.match(page, /query\.append\(key, item\)/);
  assert.doesNotMatch(page, /new URLSearchParams\(rawParams as Record<string, string>\)/);
});

test("tab and settings-section clicks replace; opening a doc is a history entry", () => {
  // Unified back A2: a tab click replaces the entry (no server round trip), so back leaves the page in one step.
  assert.match(read(PDC), /window\.history\.replaceState\(keepStamp\(window\.history\.state\), '', nextUrl\)/);
  assert.match(read("src/components/workspaces/doc/WorkspaceDocRail.tsx"), /router\[replace \? "replace" : "push"\]/);
  assert.match(read("src/hooks/useWorkspaceSettingsNavigation.ts"), /router\.replace\(`\?\$\{next\.toString\(\)\}#project-settings-/);
});

test("lifecycle rows are keyed by id, never by stage text", () => {
  const editor = read("src/components/workspaces/LifecycleEditor.tsx");
  assert.doesNotMatch(editor, /key=\{stage\}/);
  assert.match(editor, /items=\{ids\}/);
});

test("signed-out follow and apply go to sign-in with a return path", () => {
  const client = read(PDC);
  assert.match(client, /\?redirect=\$\{encodeURIComponent\(/);
  // A role's Apply button brings the visitor back to that role's form.
  assert.match(client, /searchParams\.set\('applyRole', applyRoleId\)/);
  assert.doesNotMatch(client, /Please log in to apply/);
});
