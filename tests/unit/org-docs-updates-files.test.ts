import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Live-fix phase 5 (problems 22–29, 36, 37): Documents, Updates and Files.
const source = (path: string) => readFileSync(path, "utf8");

test("live-fix 25: one docTitle helper; no copied extension regex is left", async () => {
  const { docTitle, isEmptyDoc } = await import("../../src/lib/organizations/doc-rules");
  assert.equal(docTitle("Course syllabus.md"), "Course syllabus");
  assert.equal(docTitle("notes.MARKDOWN"), "notes");
  assert.equal(isEmptyDoc("   \n", "Lab rules"), true);
  assert.equal(isEmptyDoc("# Lab rules\n", "Lab rules"), true, "only the title heading is still empty");
  assert.equal(isEmptyDoc("# Lab rules\n\nBring a laptop.", "Lab rules"), false);
  for (const path of ["src/app/actions/org-workspace.ts", "src/app/actions/org-docs.ts", "src/app/actions/org-dashboard.ts", "src/lib/organizations/needs-you.ts", "src/components/workspaces/doc/WorkspaceDocRail.tsx", "src/components/organizations/OrgDocParts.tsx"]) {
    assert.doesNotMatch(source(path), /replace\(\/\\\.\(md\|mdx\|markdown\)\$\/i/, path);
  }
});

test("live-fix 22, 24: the reader has a header with updated by, read status, Edit and ⋯; options left the rail", () => {
  const parts = source("src/components/organizations/OrgDocParts.tsx");
  assert.match(parts, /export function OrgDocHeader/);
  assert.match(parts, /Updated by /);
  assert.match(parts, /label="Document actions"|aria-label="Document actions"/);
  for (const item of ["Options…", "History", "Remove", "Publish…"]) assert.ok(parts.includes(item), item);
  assert.doesNotMatch(source("src/components/workspaces/doc/WorkspaceDocRail.tsx"), /<OrgDocAdminTools/);
  // History opens the file with its version drawer, the parameter FileView reads.
  assert.match(parts, /&filesPanel=version_history/);
  assert.match(source("src/components/workspaces/v2/files-tab/file/FileView.tsx"), /panel === "version_history"/);
});

test("live-fix 23, 26: an empty document says so with Start writing; Add offers blank or a template in the org too", () => {
  const viewer = source("src/components/workspaces/doc/WorkspaceDocViewer.tsx");
  assert.match(viewer, /isEmptyDoc\(/);
  const add = source("src/components/workspaces/doc/AddDocDialog.tsx");
  assert.match(add, /Blank, or start from a template/);
  assert.match(add, /No templates yet\. Turn one on from a document/, "the choice shows even with no templates");
  assert.match(add, /docFileName\(clean\), content: "" \}/, "a new document starts blank");
  assert.doesNotMatch(add, /org\?\.mode === "child" \? org\.docs\.filter/);
});

test("live-fix 27: the tab title says Documents and the address keeps the real slug", () => {
  assert.match(source("src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx"), /'docs' \? 'readme'|docs: 'readme'|=== 'docs' \? 'readme'/);
});

test("live-fix 28, 29: the composer toolbar wraps; Updates knows it's an organization before loading", () => {
  assert.match(source("src/components/workspaces/updates/WorkspaceUpdateComposer.tsx"), /flex-wrap/);
  assert.match(source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), /<UpdatesTab [^>]*isOrganization=\{isOrganization\}/);
});

test("live-fix 36, 37: starter folders carry a Template chip and a purpose; New folder asks who can see it", async () => {
  const { starterFolders } = await import("../../src/lib/organizations/file-rules");
  const folders = starterFolders("education");
  assert.ok(folders.some((f) => f.template === true), "the Templates folder");
  assert.ok(folders.every((f) => typeof f.purpose === "string" && f.purpose.length > 0));
  assert.match(source("src/components/workspaces/v2/files-tab/folder/FolderListRow.tsx"), /md:inline">\{\(node\.metadata as \{ purpose: string \}\)\.purpose\}/, "shown on desktop, not only in the phone meta line");
});
