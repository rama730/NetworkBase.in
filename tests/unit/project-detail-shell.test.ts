import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const PAGE = "src/app/(site)/(main)/projects/[slug]/page.tsx";
const PDC = "src/components/projects/dashboard/ProjectDashboardClient.tsx";

test("the viewer's role comes from the server capabilities, not the first members page", () => {
  assert.match(read(PAGE), /memberRole=\{capabilities\.memberRole\}/);
  const client = read(PDC);
  assert.match(client, /normalizeProjectMemberRole\(memberRole, 'member'\)/);
  assert.doesNotMatch(client, /allMembers\.find\([^)]*\)\s*;\s*return member \? normalizeProjectMemberRole/);
});

test("the canonical slug redirect keeps repeated params repeated", () => {
  const page = read(PAGE);
  assert.match(page, /query\.append\(key, item\)/);
  assert.doesNotMatch(page, /new URLSearchParams\(rawParams as Record<string, string>\)/);
});

test("tab, doc and settings-section clicks are history entries", () => {
  assert.match(read(PDC), /router\.push\(nextUrl, \{ scroll: false \}\)/);
  assert.match(read("src/components/projects/doc/ProjectDocRail.tsx"), /router\[replace \? "replace" : "push"\]/);
  assert.match(read("src/components/projects/tabs/ProjectSettingsTab.tsx"), /params\.set\("settings", sectionId\);\s*router\.push\(/);
});

test("lifecycle rows are keyed by id, never by stage text", () => {
  const editor = read("src/components/projects/LifecycleEditor.tsx");
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
