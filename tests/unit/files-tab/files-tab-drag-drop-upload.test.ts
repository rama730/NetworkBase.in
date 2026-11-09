import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Files Tab Drag & Drop Upload Integration", () => {
  const folderListViewPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/folder/FolderListView.tsx",
  );

  it("FolderListView places drops where they land, with no pop-up (CLI report §19.2)", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    assert.doesNotMatch(source, /UploadModal/);
    assert.match(source, /onDragEnter=\{handleDragEnter\}/);
    assert.match(source, /onDragOver=\{handleDragOver\}/);
    assert.match(source, /onDragLeave=\{handleDragLeave\}/);
    assert.match(source, /onDrop=\{handleDrop\}/);
    // The overlay names the destination; same names become versions; a file row takes a new version.
    assert.match(source, /Upload to \{folderPath\(folderId\)\}/);
    assert.match(source, /placeDrop\(/);
    assert.match(source, /resolveDropTarget\(/);
    assert.match(source, /saveFileRevision/);
    assert.match(source, /mode: "new_revision"/);
  });

  it("FolderListView enforces guaranteed drag state teardown and overlay resilience", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // 1. Must define unified resetDragState
    assert.match(source, /const resetDragState = React\.useCallback\(\(\) => \{/);
    assert.match(source, /dragCounterRef\.current = 0;/);
    assert.match(source, /setIsDragActive\(false\);/);

    // 2. Must register and cleanup global window dragend / drop / Escape listeners
    assert.match(source, /window\.addEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.addEventListener\("drop", handleGlobalDrop\)/);
    assert.match(source, /window\.addEventListener\("keydown", handleGlobalKeyDown\)/);
    assert.match(source, /window\.removeEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.removeEventListener\("drop", handleGlobalDrop\)/);
    assert.match(source, /window\.removeEventListener\("keydown", handleGlobalKeyDown\)/);

    // 3. Must reset drag state in handleDesktopFileDrop
    assert.match(source, /const handleDesktopFileDrop = React\.useCallback\([\s\S]*?resetDragState\(\);/);

    // 4. Must reset drag state on modal onCancel
    // 4–6. A drop resets the drag state before placing files; the overlay only shows during a drag.
    assert.match(source, /handleDesktopFileDrop = React\.useCallback\([\s\S]*?resetDragState\(\);/);
    assert.match(source, /\{isDragActive && \(/);

    // 7. Dismissible overlay: must provide click-to-dismiss and close button
    assert.match(source, /onClick=\{resetDragState\}/);
    assert.match(source, /aria-label="Dismiss drop overlay"/);
  });

  it("FileView enforces single-file drop-zone teardown and window listeners", () => {
    const fileViewPath = path.resolve(
      process.cwd(),
      "src/components/workspaces/v2/files-tab/file/FileView.tsx",
    );
    const source = readFileSync(fileViewPath, "utf-8");

    // Must define resetDragState and window listeners
    assert.match(source, /const resetDragState = React\.useCallback\(\(\) => \{/);
    assert.match(source, /window\.addEventListener\("dragend", handleGlobalDragEnd\)/);
    assert.match(source, /window\.addEventListener\("keydown", handleGlobalKeyDown\)/);
    assert.match(source, /window\.removeEventListener\("dragend", handleGlobalDragEnd\)/);

    // Must be dismissible
    assert.match(source, /aria-label="Dismiss drop overlay"/);
  });

  it("10 Ponytail Enhancements: FolderPicker ancestral auto-expansion & useFilesStore parent resolution", () => {
    const dialogsHostPath = path.resolve(
      process.cwd(),
      "src/components/workspaces/v2/explorer/ExplorerDialogsHost.tsx",
    );
    const source = readFileSync(dialogsHostPath, "utf-8");

    // Must import useFilesStore
    assert.match(source, /useFilesStore/);

    // Must traverse parent chain to auto-expand selected folder's ancestors on mount
    assert.match(source, /initialExpanded/);
    assert.match(source, /curr = nodesById\[curr\.parentId\]/);
    assert.match(source, /initialExpanded\[curr\.parentId\] = true/);
    assert.match(source, /loadPage\(ancestorId\)/);
  });

  it("10 Ponytail Enhancements: Fast-MIME fallback resolution and typed return in useExplorerMutations", () => {
    const mutationsPath = path.resolve(
      process.cwd(),
      "src/components/workspaces/v2/explorer/useExplorerMutations.ts",
    );
    const source = readFileSync(mutationsPath, "utf-8");

    // Fast-MIME dictionary and resolver
    assert.match(source, /FALLBACK_EXT_MIME/);
    assert.match(source, /resolveFileMimeType\(file: File\): string/);
    assert.match(source, /resolveFileMimeType\(f\)/);

    // uploadFiles and uploadFilesDirectly return Promise<WorkspaceNode[]>
    assert.match(source, /async \(files: File\[\], parentId: string \| null, retryToastId\?: string \| number\): Promise<WorkspaceNode\[\]>/);
    assert.match(source, /return createdNodes;/);
  });

  it("drops never wait on a dialog; new files come back from uploadFilesDirectly (no store scan)", () => {
    const source = readFileSync(folderListViewPath, "utf-8");
    const place = readFileSync(path.resolve(process.cwd(), "src/lib/files/place-drop.ts"), "utf-8");

    assert.match(source, /uploadNew: \(fresh, parentId\) => uploadFilesDirectly\(fresh, parentId\)/);
    assert.match(place, /const created = fresh\.length \? await input\.uploadNew\(fresh, parentId\) : \[\]/);
    assert.match(place, /isOsJunk\(f\.name\)/);
    assert.doesNotMatch(source, /currentNodes = useFilesStore\.getState\(\)/);
  });
});
