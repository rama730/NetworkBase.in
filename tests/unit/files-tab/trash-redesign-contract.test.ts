import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Files Tab Trash Redesign Specification Conformance Contract", () => {
  const trashPath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/TrashFilesCollection.tsx",
  );
  const headerPath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/folder/FolderListHeader.tsx",
  );

  const trashSource = readFileSync(trashPath, "utf-8");
  const headerSource = readFileSync(headerPath, "utf-8");

  it("FolderListHeader supports optional updatedLabel, byLabel, and select-all checkbox", () => {
    assert.match(
      headerSource,
      /updatedLabel\s*=\s*"Last updated"/,
      "FolderListHeader must default updatedLabel to 'Last updated'",
    );
    assert.match(
      headerSource,
      /byLabel\s*=\s*"Updated by"/,
      "FolderListHeader must default byLabel to 'Updated by'",
    );
    assert.match(
      headerSource,
      /hasCheckbox\s*=\s*false/,
      "FolderListHeader must support optional hasCheckbox",
    );
    assert.match(
      headerSource,
      /aria-label="Select all items"/,
      "FolderListHeader must render accessible select all checkbox",
    );
  });

  it("TrashFilesCollection reuses shared table components and layout grid", () => {
    // Shared table components
    assert.match(
      trashSource,
      /import[\s\S]*?FolderListHeader[\s\S]*?from\s+["'].\/folder\/FolderListHeader["']/,
      "Must import FolderListHeader",
    );
    assert.match(
      trashSource,
      /import[\s\S]*?FileTypeChip[\s\S]*?from\s+["'].\/FileTypeChip["']/,
      "Must import FileTypeChip",
    );
    assert.match(
      trashSource,
      /import[\s\S]*?FolderListLoading[\s\S]*?FolderListEmpty[\s\S]*?FolderListError[\s\S]*?from\s+["'].\/folder\/FolderListStates["']/,
      "Must import standardized loading, empty, and error states",
    );
    assert.match(
      trashSource,
      /import[\s\S]*?FOLDER_LIST_GRID_TEMPLATE[\s\S]*?from\s+["'].\/folder\/layout["']/,
      "Must import FOLDER_LIST_GRID_TEMPLATE",
    );
    assert.match(
      trashSource,
      /styles\.container/,
      "Must use FolderList responsive container class",
    );
  });

  it("TrashFilesCollection mounts FolderListHeader with Deleted at and Deleted by labels", () => {
    assert.match(
      trashSource,
      /<FolderListHeader[^>]*updatedLabel="Deleted at"[^>]*byLabel="Deleted by"/,
      "FolderListHeader in Trash must specify 'Deleted at' and 'Deleted by'",
    );
    assert.match(
      trashSource,
      /hasCheckbox=\{true\}/,
      "FolderListHeader in Trash must enable checkbox support",
    );
  });

  it("provides high-performance toolbar with category filters and inline search", () => {
    // Toolbar role
    assert.match(
      trashSource,
      /role="toolbar"\s+aria-label="Trash filters"/,
      "Must have accessible toolbar for trash filters",
    );

    // Filter items
    assert.match(trashSource, /data-testid=\{`trash-filter-\$\{item\.id\}`\}/);

    // Inline search
    assert.match(
      trashSource,
      /placeholder="Filter trash…"|placeholder="Filter trash\.\.\."/,
      "Must have inline search input",
    );
  });

  it("provides Empty Trash button in FilesHeaderSlot gated by canManageFiles", () => {
    assert.match(
      trashSource,
      /<FilesHeaderSlot slot="actions">/,
      "Must render actions slot in header",
    );
    assert.match(
      trashSource,
      /canManageFiles\s*&&\s*nodes\.length > 0/,
      "Empty trash action must be gated by canManageFiles",
    );
    assert.match(
      trashSource,
      /Empty trash/,
      "Empty trash button must be rendered",
    );
  });

  it("provides batch multi-selection and restore action", () => {
    assert.match(
      trashSource,
      /selectedIds\.size > 0/,
      "Must show batch bar when items are selected",
    );
    assert.match(
      trashSource,
      /Restore selected/,
      "Must offer batch restore action",
    );
    assert.match(
      trashSource,
      /handleBatchRestore/,
      "Must implement handleBatchRestore function",
    );
  });

  it("renders 4-column row structure with FileTypeChip, relative time, formatBytes, and UserAvatar", () => {
    // FileTypeChip
    assert.match(trashSource, /<FileTypeChip/);
    assert.match(trashSource, /isFolder=\{node\.type === "folder"\}/);

    // Formatted time and bytes
    assert.match(trashSource, /formatRelativeTime\(node\.deletedAt\)/);
    assert.match(trashSource, /formatBytes\(node\.size/);

    // UserAvatar for actor
    assert.match(trashSource, /<UserAvatar/);
    assert.match(
      trashSource,
      /identity=\{\{[\s\S]*?fullName:\s*node\.deletedByName[\s\S]*?avatarUrl:\s*node\.deletedByAvatarUrl[\s\S]*?\}\}/,
      "UserAvatar must receive fullName and avatarUrl",
    );

    const mutationsSource = readFileSync(
      path.resolve(process.cwd(), "src/app/actions/files/mutations.ts"),
      "utf-8",
    );
    assert.match(
      mutationsSource,
      /deletedByAvatarUrl:\s*profiles\.avatarUrl/,
      "getTrashPage must select deletedByAvatarUrl from profiles",
    );

    // Row grid template
    assert.match(
      trashSource,
      /style=\{\{\s*gridTemplateColumns:\s*FOLDER_LIST_GRID_TEMPLATE\s*\}\}/,
      "Each row must align with FOLDER_LIST_GRID_TEMPLATE",
    );
  });

  it("enforces strict zero rounded-full controls and zero raw zinc-* leaks", () => {
    assert.doesNotMatch(
      trashSource,
      /rounded-full/,
      "TrashFilesCollection must not have rounded-full controls",
    );

    const zincRegex = /(?:text|bg|border|divide|hover:bg|dark:text|dark:bg|dark:border|dark:hover:bg)-zinc-\d+/;
    assert.doesNotMatch(
      trashSource,
      zincRegex,
      "TrashFilesCollection must have zero raw zinc token leaks",
    );

    const blueIndigoRegex = /(?:text|bg|border|ring)-(?:blue|indigo)-\d+/;
    assert.doesNotMatch(
      trashSource,
      blueIndigoRegex,
      "TrashFilesCollection must have zero raw blue/indigo token leaks",
    );
  });

  it("retains all destructive safety contracts and fingerprint verification", () => {
    assert.match(trashSource, /getPermanentDeleteImpact/);
    assert.match(trashSource, /deletion\.fingerprint/);
    assert.match(trashSource, /autoCloseOnConfirm=\{false\}/);
    assert.match(trashSource, /response\.status === "pending"/);
    assert.match(trashSource, /canManageFiles/);
    assert.match(trashSource, /permanentDeleteRoot/);
    assert.match(trashSource, /Original location:/);
    assert.match(trashSource, /deletedByName/);
  });

  it("enforces NetworkBase crimson drafting tokens on Empty Trash button and bans raw red leaks", () => {
    assert.match(
      trashSource,
      /text-\[#96201A\]/,
      "Empty trash button must use drafting crimson text token #96201A",
    );
    assert.match(
      trashSource,
      /hover:bg-\[#FCEDEB\]/,
      "Empty trash button must use drafting crimson hover bg #FCEDEB",
    );
    assert.doesNotMatch(
      trashSource,
      /text-red-600|border-red-300|hover:bg-red-50/,
      "Must not leak raw Tailwind red utility classes",
    );
  });

  it("suppresses Git Sync and Code editor buttons in header when viewing Trash", () => {
    const workspaceHeaderPath = path.resolve(
      process.cwd(),
      "src/components/projects/v2/files-tab/FilesHeader.tsx",
    );
    const headerCode = readFileSync(workspaceHeaderPath, "utf-8");
    assert.match(
      headerCode,
      /workspace\?\.view !== "trash"[\s\S]*?<HeaderGitHubSyncButton/,
      "FilesHeader must suppress Git Sync button when view is trash",
    );
    assert.match(
      headerCode,
      /workspace\?\.view !== "trash"[\s\S]*?<OpenInIdeButton/,
      "FilesHeader must suppress OpenInIdeButton when view is trash",
    );
  });

  it("makes no auto-purge promise, and provides a search clear button and result summary", () => {
    // There is no automatic Trash cleanup, so the page must not claim one.
    assert.doesNotMatch(trashSource, /retained for 30 days/);
    assert.match(
      trashSource,
      /aria-label="Clear filter"/,
      "Search input must have clear filter button",
    );
    assert.match(
      trashSource,
      /Showing \$\{filteredNodes\.length\} of \$\{nodes\.length\} items/,
      "Toolbar must display live result count summary",
    );
  });

  it("provides desktop hover quick-restore and right-drawer inspector", () => {
    // Hover quick-restore button
    assert.match(
      trashSource,
      /group-hover:inline-flex[\s\S]*?Restore/,
      "Must provide quick-restore button on row hover",
    );

    // Inspector right-drawer
    assert.match(
      trashSource,
      /presentation="right-drawer"/,
      "Must render right-drawer inspector on row click",
    );
    assert.match(
      trashSource,
      /setInspectedNodeId\(node\.id\)/,
      "Clicking a row must open inspector for that node",
    );
  });

  it("provides 1M-scale optimizations: debounced server search, bulkRestoreNodes, batch delete, and sentinel observer", () => {
    assert.match(
      trashSource,
      /useDebounce\(inlineQuery\.trim\(\),\s*300\)/,
      "Must debounce server query by 300ms",
    );
    assert.match(
      trashSource,
      /bulkRestoreNodes/,
      "Batch restore must invoke bulkRestoreNodes action",
    );
    assert.match(
      trashSource,
      /openBulkReview\("selected"\)/,
      "Batch bar must offer batch permanent deletion (reviewed first)",
    );
    assert.match(
      trashSource,
      /sentinelRef/,
      "Must mount infinite scroll sentinel ref",
    );
    assert.match(
      trashSource,
      /new IntersectionObserver/,
      "Must attach IntersectionObserver for continuous infinite scroll",
    );
  });
});
