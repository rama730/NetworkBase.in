import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFolderExportEntries,
  FOLDER_EXPORT_MAX_BYTES,
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
