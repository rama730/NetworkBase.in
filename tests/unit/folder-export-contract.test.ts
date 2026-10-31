import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildFolderExportEntries,
  buildSelectionExportEntries,
  FOLDER_EXPORT_MAX_BYTES,
  uniqueExportName,
  type FolderExportRow,
} from "@/lib/files/folder-export-contract";

function row(overrides: Partial<FolderExportRow> & Pick<FolderExportRow, "id" | "name" | "type">): FolderExportRow {
  return {
    id: overrides.id,
    parent_id: null,
    type: overrides.type,
    name: overrides.name,
    s3_key: overrides.type === "file" ? `legacy/${overrides.id}` : null,
    asset_id: null,
    size: overrides.type === "file" ? 1 : 0,
    depth: 0,
    task_id: null,
    path: `/${overrides.name}`,
    asset_state: null,
    asset_bucket: null,
    asset_storage_key: null,
    asset_size: null,
    ...overrides,
  };
}

test("folder export preserves separate logical paths that share immutable bytes", () => {
  const rows = [
    row({ id: "root", name: "Folder", type: "folder" }),
    row({
      id: "first",
      parent_id: "root",
      name: "first.txt",
      type: "file",
      asset_id: "asset",
      asset_state: "verified",
      asset_bucket: "project-files",
      asset_storage_key: "immutable/asset",
      asset_size: 4,
    }),
    row({
      id: "second",
      parent_id: "root",
      name: "second.txt",
      type: "file",
      asset_id: "asset",
      asset_state: "verified",
      asset_bucket: "project-files",
      asset_storage_key: "immutable/asset",
      asset_size: 4,
    }),
  ];

  const result = buildFolderExportEntries(rows, "root");
  assert.deepEqual(result.entries.map((entry) => entry.path), ["first.txt", "second.txt"]);
  assert.equal(result.totalBytes, 8);
});

test("folder export rejects traversal-like names and unavailable assets", () => {
  assert.throws(
    () => buildFolderExportEntries([row({ id: "bad", name: "..", type: "file" })], null),
    /unsafe file name/,
  );
  assert.throws(
    () => buildFolderExportEntries([row({
      id: "pending",
      name: "pending.txt",
      type: "file",
      asset_id: "asset",
      asset_state: "pending",
      asset_storage_key: "immutable/pending",
      asset_size: 1,
    })], null),
    /not available/,
  );
});

test("folder export applies the aggregate byte cap before streaming", () => {
  assert.throws(
    () => buildFolderExportEntries([row({
      id: "huge",
      name: "huge.bin",
      type: "file",
      size: FOLDER_EXPORT_MAX_BYTES + 1,
    })], null),
    /limited to 1 GiB/,
  );
});

test("chosen items sit at the top of the zip, and same-named items both survive", () => {
  const rows = [
    row({ id: "a", parent_id: "x", name: "report.pdf", type: "file" }),
    row({ id: "b", parent_id: "y", name: "report.pdf", type: "file" }),
    row({ id: "d", parent_id: "x", name: "Designs", type: "folder" }),
    row({ id: "e", parent_id: "d", name: "logo.png", type: "file" }),
  ];
  const { entries } = buildSelectionExportEntries(rows);
  assert.deepEqual(entries.map((entry) => entry.path).sort(), ["Designs/", "Designs/logo.png", "report (2).pdf", "report.pdf"]);
});

test("an item chosen along with its folder appears once, inside that folder", () => {
  const rows = [
    row({ id: "d", name: "Designs", type: "folder" }),
    row({ id: "e", parent_id: "d", name: "logo.png", type: "file" }),
    row({ id: "e", parent_id: "d", name: "logo.png", type: "file" }),
  ];
  assert.deepEqual(buildSelectionExportEntries(rows).entries.map((entry) => entry.path).sort(), ["Designs/", "Designs/logo.png"]);
});

test("names that differ only by case can't overwrite each other when unzipped", () => {
  const used = new Set<string>();
  assert.equal(uniqueExportName(used, "Notes.txt"), "Notes.txt");
  assert.equal(uniqueExportName(used, "notes.txt"), "notes (2).txt");
  assert.equal(uniqueExportName(used, "README"), "README");
  assert.equal(uniqueExportName(used, "README"), "README (2)");
});

test("the zip routes can be checked without pinning, and a stalled client can't outlive the deadline", () => {
  const stream = readFileSync("src/lib/files/folder-export.ts", "utf8");
  assert.match(stream, /outputController\.error\(reason\)/);
  assert.equal((stream.match(/if \(!input\.dryRun\) await pinExportAssets/g) ?? []).length, 2);
  assert.ok(stream.indexOf("Submissions are limited to 1 GB") < stream.indexOf("if (!input.dryRun) await pinExportAssets(tx, list"), "size is checked before pinning");
  for (const route of ["src/app/api/v1/workspaces/[id]/files/export/route.ts", "src/app/api/v1/workspaces/[id]/tasks/[taskId]/submissions/route.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /export async function HEAD/, route);
    assert.match(source, /dryRun: isCheck/, route);
  }
  const submissions = readFileSync("src/app/api/v1/workspaces/[id]/tasks/[taskId]/submissions/route.ts", "utf8");
  assert.match(submissions, /"files:submissions"/);
  assert.doesNotMatch(submissions, /"files:export"/);
  const exportRoute = readFileSync("src/app/api/v1/workspaces/[id]/files/export/route.ts", "utf8");
  assert.match(exportRoute, /exportEntriesStillVisible/);
});

test("a file with no stored copy is left out of a zip and counted, not fatal", () => {
  const { entries, skippedFiles } = buildFolderExportEntries([
    row({ id: "kept", name: "kept.txt", type: "file" }),
    row({ id: "linked", name: "linked.md", type: "file", s3_key: null }),
    row({ id: "bin", name: "logo.png", type: "file", s3_key: null }),
  ], null);
  assert.deepEqual(entries.map((entry) => entry.path), ["kept.txt"]);
  assert.equal(skippedFiles, 2);
});

test("a teammate deleting a file doesn't stop a zip already holding it", () => {
  const stream = readFileSync("src/lib/files/folder-export.ts", "utf8");
  const check = stream.slice(stream.indexOf("export async function exportEntriesStillVisible"), stream.indexOf("export async function releaseFolderExport"));
  assert.doesNotMatch(check, /deleted_at/);
});
