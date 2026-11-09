import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { extOf } from "@/components/workspaces/v2/utils/fileKind";

const read = (path: string) => readFileSync(path, "utf8");
const V2 = "src/components/workspaces/v2";

test("one extension helper handles names without a dot", () => {
  assert.equal(extOf("README"), "");
  assert.equal(extOf("a.TAR.GZ"), "gz");
  for (const file of [`${V2}/files-tab/file/FileView.tsx`, `${V2}/files-tab/file/FileActionsBar.tsx`, "src/hooks/useFileVersions.ts"]) {
    assert.doesNotMatch(read(file), /function extOf\(/, file);
  }
});

test("lease renewal never flips the editor read-only, and duplicated tabs never share a lease id", () => {
  const lease = read(`${V2}/files-tab/hooks/useFileLease.ts`);
  assert.doesNotMatch(lease, /setStatus\("renewing"\)/);
  assert.match(lease, /document\.hidden && !keepAliveRef\.current/);
  assert.doesNotMatch(read("src/lib/files/file-lease-client.ts"), /sessionStorage\.(get|set)Item/);
});

test("trash: no promise of an auto-purge that does not exist, and bulk deletes are reviewed first", () => {
  const trash = read(`${V2}/files-tab/TrashFilesCollection.tsx`);
  assert.doesNotMatch(trash, /retained for 30 days/);
  assert.match(trash, /getBulkPermanentDeleteImpact/);
  assert.doesNotMatch(trash, /for \(const node of nodes\) \{\s*try \{\s*const impact = await getPermanentDeleteImpact/);
});

test("attach-to-task refreshes the real queries; quick open hides storage folders", () => {
  const list = read(`${V2}/files-tab/folder/FolderListView.tsx`);
  assert.doesNotMatch(list, /queryKey: \["task-links"/);
  // Drops no longer link to a task from the Files list (CLI report §19.2: task files are added from the task or its group).
  assert.match(read(`${V2}/files-tab/quick-open/QuickOpenDialog.tsx`), /isInternalTaskWorkingFilesNode\(node\)/);
});
