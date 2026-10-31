import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { signedDownloadRedirect } from "../../src/lib/storage/download-link";
import { versionedFilename } from "../../src/lib/files/versioned-filename";

const read = (path: string) => readFileSync(path, "utf8");

test("a download redirect is a one-minute attachment link that is never cached", async () => {
  const calls: unknown[][] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (key: string, seconds: number, options: unknown) => {
          calls.push([bucket, key, seconds, options]);
          return { data: { signedUrl: "https://storage.test/signed" }, error: null };
        },
      }),
    },
  };
  const res = await signedDownloadRedirect(admin as never, { bucket: "b", storageKey: "k", filename: "日本語.pdf" });
  assert.equal(res!.status, 302);
  assert.equal(res!.headers.get("location"), "https://storage.test/signed");
  assert.equal(res!.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [["b", "k", 60, { download: "日本語.pdf" }]]);
});

test("a failed signing returns nothing, so the route can answer with an error", async () => {
  const admin = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error("x") }) }) } };
  assert.equal(await signedDownloadRedirect(admin as never, { bucket: "b", storageKey: "k", filename: "a" }), null);
});

test("an old version keeps its extension, so it still opens normally", () => {
  assert.equal(versionedFilename("report.pdf", 3), "report.v3.pdf");
  assert.equal(versionedFilename("archive.tar.gz", 2), "archive.tar.v2.gz");
  assert.equal(versionedFilename("README", 4), "README.v4");
  assert.equal(versionedFilename(".env", 4), ".env.v4");
});

test("chat and workspace files have a real download mode and a cheap status check", () => {
  const chat = read("src/app/api/v1/chat/attachments/[assetId]/route.ts");
  assert.match(chat, /searchParams\.get\("download"\) === "1"/);
  assert.match(chat, /signedDownloadRedirect/);
  assert.match(chat, /export async function HEAD/);
  const preview = read("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");
  assert.match(preview, /signedDownloadRedirect/);
  assert.match(preview, /versionedFilename\(node\.name, revisionNumber!\)/);
  const media = read("src/app/api/v1/workspaces/[id]/update-media/route.ts");
  assert.match(media, /searchParams\.get\("download"\) === "1" \? "attachment" : "inline"/);
});

// fetch() must read same-origin bytes; download mode redirects to storage on another origin.
test("code that reads a file's bytes never asks for download mode", () => {
  for (const file of ["src/components/organizations/OrgFilesPanel.tsx", "src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts"]) {
    assert.doesNotMatch(read(file), /fetch\([^)]*download=1/, file);
  }
});

const componentFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? componentFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
});

// A raw link can't see a refused download: the browser saves the error as the file, or leaves the page.
test("no control saves a file except through the shared helper", () => {
  const allowed = new Set([
    "src/lib/download.ts",
  ]);
  const offenders = [...componentFiles("src/components"), ...componentFiles("src/app"), ...componentFiles("src/hooks")]
    .filter((file) => !allowed.has(file))
    .filter((file) => /\bdownload=\{|<a[^>]*\sdownload[\s>]|\.download\s*=|download: `/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("downloads are recorded after the response; checks and views are not", () => {
  const preview = read("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");
  assert.ok(preview.indexOf('request.method === "HEAD"') < preview.indexOf("recordDownload("));
  assert.equal((preview.match(/recordDownload\(/g) ?? []).length, 1);
  assert.ok(preview.indexOf("recordDownload(") < preview.indexOf("const revisionIdentity"), "only the download branch records");
  for (const file of ["src/app/api/v1/workspaces/[id]/files/export/route.ts", "src/app/api/v1/workspaces/[id]/tasks/[taskId]/submissions/route.ts"]) {
    const source = read(file);
    assert.ok(source.indexOf("if (isCheck) return") < source.indexOf("recordDownload("), file);
  }
  assert.match(read("src/lib/files/download-history.ts"), /after\(\(\) => insertDownloadEvent/);
  assert.doesNotMatch(read("src/app/api/v1/chat/attachments/[assetId]/route.ts"), /recordDownload/);
  assert.match(read("src/inngest/registry.ts"), /downloadHistoryRetention/);
});

test("print frames stay until the dialog closes, and the account export check uses nothing up", () => {
  for (const file of ["src/components/messages/CanvasEditor.tsx", "src/components/workspaces/v2/preview/drivers/DocxViewerDriver.tsx"]) {
    assert.match(read(file), /addEventListener\("afterprint"/, file);
  }
  assert.doesNotMatch(read("src/components/workspaces/v2/preview/drivers/DocxViewerDriver.tsx"), /<title>\$\{node\.name\}<\/title>/);
  const route = read("src/app/api/v1/account/export/route.ts");
  const head = route.slice(route.indexOf("export async function HEAD"));
  assert.doesNotMatch(head, /consumeRateLimit|createAccountExportStream/);
  assert.match(head, /"?Retry-After"?|'Retry-After'/);
});

test("anyone who can see a folder can pick files to download, and only editors can delete them", () => {
  const list = read("src/components/workspaces/v2/files-tab/folder/FolderListView.tsx");
  assert.doesNotMatch(read("src/components/workspaces/v2/files-tab/folder/FolderListRow.tsx"), /canEdit && onSelectionChange/);
  assert.match(list, /canEditCurrentFolder && <DropdownMenuItem disabled=\{!selectedItems\.length\} variant="destructive"/);
  assert.doesNotMatch(list, /canEditCurrentFolder && <><DropdownMenuSeparator \/><DropdownMenuItem onSelect=\{\(\) => \{ setSelectionMode\(true\)/);
});

