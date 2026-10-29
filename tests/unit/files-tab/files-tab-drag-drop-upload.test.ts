import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Files Tab Drag & Drop Upload Integration", () => {
  const modalPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/upload/FilesTabUploadModal.tsx",
  );
  const folderListViewPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/folder/FolderListView.tsx",
  );

  it("FilesTabUploadModal exports expected contract and intents", () => {
    const source = readFileSync(modalPath, "utf-8");

    // Must export the modal and confirm result type
    assert.match(source, /export function FilesTabUploadModal/);
    assert.match(source, /export type FilesUploadIntent =/);
    assert.match(source, /export interface FilesTabUploadConfirmResult/);

    // Must support all 5 intents (matching Task Panel UX + All files)
    assert.match(source, /"project"/);
    assert.match(source, /"reference"/);
    assert.match(source, /"working"/);
    assert.match(source, /"deliverable"/);
    assert.match(source, /"version"/);

    // Must provide categories
    assert.match(source, /All files/);
    assert.match(source, /Task reference/);
    assert.match(source, /Draft file/);
    assert.match(source, /Final file/);
    assert.match(source, /New version of a file/);

    // Must support smart collision detection
    assert.match(source, /matchingExistingFile/);
    assert.match(source, /Matching file detected:/);

    // Must support folder picker & task search
    assert.match(source, /FolderPicker/);
    assert.match(source, /searchProjectTasks/);

    // Must support pre-upload file rename
    assert.match(source, /renameFileObject/);
    assert.match(source, /isRenamingSingle/);
    assert.match(source, /applySingleRename/);
    assert.match(source, /Rename file/);

    // Must prevent close button overlap with generous right clearance and separate extension truncation
    assert.match(source, /<DialogHeader className="pr-10">/);
    assert.match(source, /singleFileNameParts/);
  });

  it("FolderListView implements container drag & drop with overlay and upload modal", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // Must import the modal
    assert.match(source, /FilesTabUploadModal/);

    // Must handle container-level drag events
    assert.match(source, /onDragEnter=\{handleDragEnter\}/);
    assert.match(source, /onDragOver=\{handleDragOver\}/);
    assert.match(source, /onDragLeave=\{handleDragLeave\}/);
    assert.match(source, /onDrop=\{handleDrop\}/);

    // Must mount visual drop overlay
    assert.match(source, /Drop files to upload/);

    // Must mount the categorization modal on drop
    assert.match(source, /<FilesTabUploadModal/);
    assert.match(source, /onConfirm=\{handleConfirmDropUpload\}/);

    // Must route new version saves to saveFileRevision
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
    assert.match(source, /onCancel=\{\(\) => \{[\s\S]*?resetDragState\(\);/);

    // 5. Must reset drag state in handleConfirmDropUpload finally block
    assert.match(source, /finally \{[\s\S]*?resetDragState\(\);/);

    // 6. Mutual exclusivity: overlay must NOT render while pendingUploadFiles modal is open
    assert.match(source, /\{isDragActive && !pendingUploadFiles && \(/);

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

  it("FilesTabUploadModal supports single-back-button full-length project-tree isolation", () => {
    const source = readFileSync(modalPath, "utf-8");

    // Must track expandedCard state for full-length tree view
    assert.match(source, /const \[expandedCard, setExpandedCard\] = useState<"project" \| "deliverable" \| null>\(null\);/);

    // Must provide Back to categories button when expanded
    assert.match(source, /onClick=\{\(\) => setExpandedCard\(null\)\}/);
    assert.match(source, /Back to categories/);

    // Must conditionally render Categories Overview when expandedCard === null
    assert.match(source, /\{expandedCard === null && \(/);

    // Must render isolated full-length All files tree view when expandedCard === "project"
    assert.match(source, /\{expandedCard === "project" && \(/);

    // Must render isolated full-length Final file tree view when expandedCard === "deliverable"
    assert.match(source, /\{expandedCard === "deliverable" && \(/);

    // Must render FolderPicker inside both expanded tree views
    const projectSection = source.slice(
      source.indexOf('{expandedCard === "project" && ('),
      source.indexOf('{expandedCard === "deliverable" && ('),
    );
    assert.match(projectSection, /<FolderPicker/);
    assert.doesNotMatch(projectSection, /Task reference/);
    assert.doesNotMatch(projectSection, /Draft file/);
    assert.doesNotMatch(projectSection, /New version of a file/);

    const deliverableSection = source.slice(
      source.indexOf('{expandedCard === "deliverable" && ('),
      source.indexOf("<DialogFooter"),
    );
    assert.match(deliverableSection, /<FolderPicker/);
    assert.doesNotMatch(deliverableSection, /All files/);
    assert.doesNotMatch(deliverableSection, /Task reference/);
    assert.doesNotMatch(deliverableSection, /Draft file/);
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

  it("upload categories require an explicit choice while preserving Escape, destination and file controls", () => {
    const source = readFileSync(modalPath, "utf-8");

    // 2-level Escape: intercept onEscapeKeyDown and onKeyDown
    assert.match(source, /onEscapeKeyDown=\{/);
    assert.match(source, /e\.key === "Escape" && expandedCard !== null/);

    // Destination badge / breadcrumb pill in header
    assert.match(source, /Destination:/);
    assert.match(source, /destinationFolderName/);

    // No filename, collision, or task heuristic may preselect a category.
    assert.doesNotMatch(source, /computeInitialIntent/);
    assert.match(source, /useState<FilesUploadIntent \| null>\(null\)/);
    assert.match(source, /setIntent\(null\)/);
    assert.match(source, /intent === null \|\|/);
    assert.match(source, /disabled=\{isConfirmDisabled\}/);
    assert.match(source, /if \(isConfirmDisabled \|\| intent === null\) return/);

    // Removable chips list with remove button & aggregate size
    assert.match(source, /formatBytes\(totalBytes\)/);
    assert.match(source, /fileList\.map\(\(file, idx\) =>/);
    assert.match(source, /aria-label=\{`Remove \$\{file\.name\}`\}/);

    // Zero-byte preflight warning banner
    assert.match(source, /zeroByteFiles/);
    assert.match(source, /0-byte file warning:/);

    // Smooth layout transitions
    assert.match(source, /animate-in fade-in-50 duration-150/);
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

    // uploadFiles and uploadFilesDirectly return Promise<ProjectNode[]>
    assert.match(source, /async \(files: File\[\], parentId: string \| null, retryToastId\?: string \| number\): Promise<ProjectNode\[\]>/);
    assert.match(source, /return createdNodes;/);
  });

  it("10 Ponytail Enhancements: Client-side OS junk stripping, optimistic modal teardown & deterministic task linking", () => {
    const source = readFileSync(folderListViewPath, "utf-8");

    // Optimistic teardown: pendingUploadFiles reset immediately before background upload
    assert.match(source, /setPendingUploadFiles\(null\);[\s\S]*?uploadFilesDirectly\(filesToUpload, target\)/);

    // Deterministic task linking: uses createdNodes directly from uploadFilesDirectly without scanning nodesById
    assert.match(source, /uploadFilesDirectly\(filesToUpload, target\)\s*\.then\(async \(createdNodes\) => \{[\s\S]*?for \(const node of nodes\) \{[\s\S]*?await linkNodeToTask\(taskId, node\.id[\s\S]*?await linkAll\(createdNodes\)/);
    assert.doesNotMatch(source, /currentNodes = useFilesStore\.getState\(\)/);
  });
});
