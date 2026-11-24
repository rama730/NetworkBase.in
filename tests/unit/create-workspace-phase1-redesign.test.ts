import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildUploadManifest } from "../../src/components/workspaces/create-wizard/phase1/upload-manifest";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "../../src/lib/upload/security";

function file(name: string, path: string, size: number, type = "text/plain"): File {
  return { name, webkitRelativePath: path, size, type } as File;
}

test("folder preflight reports files, bytes, warnings, duplicates, and oversized files", () => {
  const manifest = buildUploadManifest([
    file("index.ts", "demo/src/index.ts", 128),
    file("empty.txt", "demo/empty.txt", 0),
    file("INDEX.ts", "demo/src/INDEX.ts", 64),
    file("large.bin", "demo/large.bin", WORKSPACE_UPLOAD_MAX_FILE_BYTES + 1),
    file("unsafe.svg", "demo/unsafe.svg", 10, "image/svg+xml"),
  ]);

  assert.equal(manifest.folderName, "demo");
  assert.equal(manifest.totalFiles, 5);
  assert.equal(manifest.totalBytes, WORKSPACE_UPLOAD_MAX_FILE_BYTES + 203);
  assert.equal(manifest.warningCount, 1);
  assert.equal(manifest.blockedCount, 3);
  assert.equal(manifest.isValid, false);
});

test("phase 1 keeps one named radio source selector and a flat accessible repository tree", async () => {
  const [selector, phase, githubDetails, uploadManifest] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/phase1/Phase1SourceMethodGroup.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/phases/Phase1SourceSelection.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/phase1/GithubImportDetails.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/phase1/UploadManifestPreview.tsx", "utf8"),
  ]);

  assert.match(selector, /type="radio"/);
  assert.match(selector, /name="create-project-source"/);
  assert.match(selector, /How do you want to start\?/);
  assert.match(selector, /border-primary bg-secondary/);
  // Three cards in a row; four when the Organization card shows.
  assert.match(selector, /md:grid-cols-2", showOrganization \? "xl:grid-cols-4" : "lg:grid-cols-3"/);
  // Tiles size to their content (compact rows on phones), no fixed minimum height.
  assert.doesNotMatch(selector, /min-h-44/);
  assert.match(selector, /p-4 text-left md:p-6/);
  assert.doesNotMatch(selector, /size-2 rounded-full bg-primary/);
  assert.doesNotMatch(selector, /rounded-full border/);
  assert.match(phase, /role="treeitem"/);
  assert.match(phase, /aria-level=/);
  assert.match(phase, /aria-expanded=/);
  assert.doesNotMatch(phase, /📁|📄/);
  assert.doesNotMatch(phase, /create-project-back-to-source-grid/);
  assert.match(phase, /Start empty/);
  assert.match(phase, /Set up the workspace in the next steps/);
  assert.match(phase, /No repository or folder attached\./);
  assert.match(phase, /<GithubImportDetails/);
  assert.match(phase, /githubAnalysisResult\?\.description/);
  assert.match(phase, /border-b-2 border-primary/);
  assert.match(phase, /Browse repositories/);
  assert.match(phase, /Refresh repositories/);
  assert.match(phase, /hasLoadedGithubRepo/);
  assert.match(phase, /create-project-github-resolved-branch/);
  assert.match(phase, /!hasLoadedGithubRepo \? \(/);
  assert.doesNotMatch(phase, /GithubIPhonePreview/);
  assert.match(githubDetails, /Files to import/);
  assert.match(githubDetails, /branchControl/);
  assert.doesNotMatch(githubDetails, /rounded-\[3rem\]/);
  assert.doesNotMatch(githubDetails, /app-scroll/);
  assert.doesNotMatch(uploadManifest, /app-scroll/);
});

test("wizard shell is reactive, uses the workspace-setup exit dialog, and chunks upload signing", async () => {
  const [wizard, hook, footer, folderUpload] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/lib/upload/chunked-upload.ts", "utf8"),
  ]);

  // Reactive via a real subscription (useWatch); render-time watch() went stale after GitHub -> Scratch.
  assert.match(wizard, /useWatch\(\{[\s\S]*'import_source\.metadata'\]/);
  assert.match(wizard, /<LeaveWorkspaceSetupDialog/);
  assert.match(wizard, /app-scroll app-scroll-y app-scroll-gutter/);
  // A page in the app shell (spec §18): fills the main area, content in the shared 1000px column.
  assert.ok(wizard.includes("relative flex h-full min-h-0 w-full flex-col"));
  // v6: the body starts at the left edge; the footer spans the page with 24px gutters.
  assert.ok(wizard.includes("max-w-[940px]"));
  assert.ok(footer.includes("sm:px-6"));
  assert.doesNotMatch(wizard, /presentation/);
  assert.match(hook, /getUploadPresignedUrl/);
  assert.match(folderUpload, /getPresignedUrl/);
  assert.match(folderUpload, /const DEFAULT_MAX_CONCURRENCY = 4/);
  assert.match(folderUpload, /Math\.min\(DEFAULT_MAX_CONCURRENCY,/);
  assert.match(folderUpload, /uploadToSupabaseSignedUrl/);
  assert.doesNotMatch(hook, /uploadUrlRequests\.slice\(offset, offset \+ 200\)/);
  assert.match(hook, /branchOverride \?\? watchedBranch/);
  assert.match(hook, /setGithubFolderEntries\(\{\}\)/);
  assert.doesNotMatch(hook, /window\.scrollTo/);
  assert.match(footer, /Create workspace/);
  assert.doesNotMatch(footer, /Launch Project/);
});
