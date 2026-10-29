import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task Files Design Specification Conformance Contract", async (t) => {
  const filesTabDir = path.join(
    process.cwd(),
    "src/components/projects/v2/files-tab",
  );
  const taskFilesCollection = fs.readFileSync(
    path.join(filesTabDir, "TaskFilesCollection.tsx"),
    "utf-8",
  );

  await t.test("Imports and renders standardized FolderListHeader", () => {
    assert.match(
      taskFilesCollection,
      /import\s+.*FolderListHeader.*from\s+["'].\/folder\/FolderListHeader["']/,
      "TaskFilesCollection must import FolderListHeader",
    );
    assert.match(
      taskFilesCollection,
      /<FolderListHeader\s*\/>/,
      "TaskFilesCollection must render <FolderListHeader />",
    );
  });

  await t.test("Reuses standardized FolderListStates (Loading, Empty, Error)", () => {
    assert.match(
      taskFilesCollection,
      /FolderListLoading/,
      "TaskFilesCollection must use FolderListLoading",
    );
    assert.match(
      taskFilesCollection,
      /FolderListEmpty/,
      "TaskFilesCollection must use FolderListEmpty",
    );
    assert.match(
      taskFilesCollection,
      /FolderListError/,
      "TaskFilesCollection must use FolderListError",
    );
  });

  await t.test("Uses FileTypeChip with isFolder for warm drafting folder container", () => {
    assert.match(
      taskFilesCollection,
      /import\s+.*FileTypeChip.*from\s+["'].\/FileTypeChip["']/,
      "TaskFilesCollection must import FileTypeChip",
    );
    assert.match(
      taskFilesCollection,
      /<FileTypeChip[^>]*isFolder=\{true\}/,
      "TaskFilesCollection must render FileTypeChip with isFolder={true}",
    );
    // Must not use raw unstyled blue folder icon for rows
    assert.doesNotMatch(
      taskFilesCollection,
      /<FolderOpen[^>]*text-\[#2563C9\]/,
      "TaskFilesCollection must not use raw unstyled blue FolderOpen icon",
    );
  });

  await t.test("Conforms to 4-column layout with standard grid template and row height", () => {
    assert.match(
      taskFilesCollection,
      /FOLDER_LIST_GRID_TEMPLATE/,
      "TaskFilesCollection must use FOLDER_LIST_GRID_TEMPLATE",
    );
    assert.match(
      taskFilesCollection,
      /FOLDER_LIST_ROW_HEIGHT_PX/,
      "TaskFilesCollection must use FOLDER_LIST_ROW_HEIGHT_PX",
    );
    assert.match(
      taskFilesCollection,
      /data-column="name"/,
      "TaskFilesCollection must have Name column",
    );
    assert.match(
      taskFilesCollection,
      /data-column="updated"/,
      "TaskFilesCollection must have Updated column",
    );
    assert.match(
      taskFilesCollection,
      /data-column="size"/,
      "TaskFilesCollection must have Size column",
    );
    assert.match(
      taskFilesCollection,
      /data-column="by"/,
      "TaskFilesCollection must have By column",
    );
    assert.match(
      taskFilesCollection,
      /data-column="actions"/,
      "TaskFilesCollection must have Actions column",
    );
  });

  await t.test("Provides contextual action menu with Open, View in board, and Copy link", () => {
    assert.match(
      taskFilesCollection,
      /Open task files/,
      "TaskFilesCollection action menu must include 'Open task files'",
    );
    assert.match(
      taskFilesCollection,
      /View in Tasks board/,
      "TaskFilesCollection action menu must include 'View in Tasks board'",
    );
    assert.match(
      taskFilesCollection,
      /Copy link/,
      "TaskFilesCollection action menu must include 'Copy link'",
    );
  });

  await t.test("Strict zero rounded-full controls in TaskFilesCollection", () => {
    assert.doesNotMatch(
      taskFilesCollection,
      /rounded-full/,
      "TaskFilesCollection must not have rounded-full controls",
    );
  });

  await t.test("Strict zero raw zinc-* color token leaks in TaskFilesCollection", () => {
    const zincRegex =
      /(?:text|bg|border|divide|hover:bg|dark:text|dark:bg|dark:border|dark:hover:bg)-zinc-\d+/;
    assert.doesNotMatch(
      taskFilesCollection,
      zincRegex,
      "TaskFilesCollection must have zero raw zinc token leaks",
    );
  });

  await t.test("Strict zero raw blue/indigo button styling in TaskFilesCollection", () => {
    const rawBlueBtnRegex =
      /(?:bg-blue-|bg-indigo-|hover:bg-blue-|hover:bg-indigo-)\d+/;
    assert.doesNotMatch(
      taskFilesCollection,
      rawBlueBtnRegex,
      "TaskFilesCollection must have zero raw blue/indigo button token leaks",
    );
  });

  await t.test("Feature 1 & 3: Inline title, status badge and review pending badges", () => {
    assert.match(
      taskFilesCollection,
      /data-testid="task-group-status-badge"/,
      "TaskFilesCollection must render task group status badge",
    );
    assert.match(
      taskFilesCollection,
      /data-testid="task-group-review-badge"/,
      "TaskFilesCollection must render review pending badge",
    );
    assert.match(
      taskFilesCollection,
      /Review pending/,
      "TaskFilesCollection must show 'Review pending' label",
    );
    assert.match(
      taskFilesCollection,
      /Changes requested/,
      "TaskFilesCollection must show 'Changes requested' label",
    );
  });

  await t.test("Feature 2: Role breakdown in Size column", () => {
    assert.match(
      taskFilesCollection,
      /\$\{group\.working\}w\s*·\s*\$\{group\.references\}r/,
      "TaskFilesCollection size column must format role breakdown as 'w · r'",
    );
    assert.match(
      taskFilesCollection,
      /working.*references/,
      "TaskFilesCollection must provide informative size tooltip",
    );
  });

  await t.test("Feature 4: Direct upload to task row action and modal integration", () => {
    assert.match(
      taskFilesCollection,
      /Upload file to task…/,
      "TaskFilesCollection action menu must include 'Upload file to task…'",
    );
    assert.match(
      taskFilesCollection,
      /<FilesTabUploadModal/,
      "TaskFilesCollection must mount FilesTabUploadModal",
    );
  });

  await t.test("Feature 5: Interactive column sorting and status filter toolbar", () => {
    assert.match(
      taskFilesCollection,
      /aria-label="Task status filters"/,
      "TaskFilesCollection must render task status filters toolbar",
    );
    assert.match(
      taskFilesCollection,
      /data-testid=\{`task-filter-\$\{item\.id\}`\}/,
      "TaskFilesCollection must assign data-testid for status filters",
    );
    assert.match(
      taskFilesCollection,
      /\{ id: "all", label: "All" \}/,
      "TaskFilesCollection must include 'all' filter option",
    );
    assert.match(
      taskFilesCollection,
      /\{ id: "todo", label: "To do" \}/,
      "TaskFilesCollection must include 'todo' filter option",
    );
    assert.match(
      taskFilesCollection,
      /\{ id: "in_progress", label: "In progress" \}/,
      "TaskFilesCollection must include 'in_progress' filter option",
    );
    assert.match(
      taskFilesCollection,
      /\{ id: "done", label: "Completed" \}/,
      "TaskFilesCollection must include 'done' filter option",
    );
    assert.match(
      taskFilesCollection,
      /\{ id: "review", label: "In review" \}/,
      "TaskFilesCollection must include 'review' filter option",
    );
    assert.match(
      taskFilesCollection,
      /onSort=\{handleSort\}/,
      "TaskFilesCollection must wire onSort to FolderListHeader",
    );
  });

  await t.test("Feature 6: Author micro-avatar rendering in Updated By column", () => {
    assert.match(
      taskFilesCollection,
      /<UserAvatar/,
      "TaskFilesCollection must render UserAvatar in Updated by column",
    );
    assert.match(
      taskFilesCollection,
      /size=\{18\}/,
      "TaskFilesCollection UserAvatar must be 18px",
    );
  });

  await t.test("Feature 7: keyboard navigation without hover server actions", () => {
    assert.doesNotMatch(
      taskFilesCollection,
      /onMouseEnter=\{.*handlePrefetchTask/,
      "TaskFilesCollection rows must not fire server actions on hover",
    );
    assert.match(
      taskFilesCollection,
      /ArrowDown/,
      "TaskFilesCollection must handle ArrowDown key navigation",
    );
    assert.match(
      taskFilesCollection,
      /ArrowUp/,
      "TaskFilesCollection must handle ArrowUp key navigation",
    );
  });

  await t.test("Unification: Deliverables merged into Task files with in-task role filtering", () => {
    const sidebar = fs.readFileSync(
      path.join(filesTabDir, "FilesTabSidebar.tsx"),
      "utf-8",
    );
    assert.match(
      sidebar,
      /item\.id !== "deliverables"/,
      "FilesTabSidebar must filter out standalone deliverables section",
    );
    assert.match(
      taskFilesCollection,
      /<DropdownMenuRadioItem value="deliverable">Final files<\/DropdownMenuRadioItem>/,
      "TaskFilesCollection must include Deliverables in in-task File purpose dropdown",
    );
    assert.match(
      taskFilesCollection,
      /entry\.role === "deliverable"/,
      "TaskFilesCollection must render deliverable label for deliverable entries inside task",
    );
  });

  await t.test("Six Enhancements: Live counts, inline search, primary upload, clean size chips, sidebar sync, header balance", () => {
    const sidebar = fs.readFileSync(
      path.join(filesTabDir, "FilesTabSidebar.tsx"),
      "utf-8",
    );
    const layout = fs.readFileSync(
      path.join(filesTabDir, "folder", "layout.ts"),
      "utf-8",
    );
    const header = fs.readFileSync(
      path.join(filesTabDir, "folder", "FolderListHeader.tsx"),
      "utf-8",
    );

    // 1. Status live counts
    assert.match(
      taskFilesCollection,
      /statusCounts\[item\.id\]/,
      "TaskFilesCollection must display live counts on status filter pills",
    );

    // 2. Inline filter / search
    assert.match(
      taskFilesCollection,
      /placeholder="Filter tasks…"|placeholder="Filter tasks…"/,
      "TaskFilesCollection must render inline fuzzy search input",
    );

    // 3. Section 23 primary upload toolbar affordance
    assert.match(
      taskFilesCollection,
      /<FilesHeaderSlot slot="actions">/,
      "TaskFilesCollection must mount primary upload slot in header actions",
    );

    // 4. Clean role breakdown chips (no 0r/0w noise)
    assert.match(
      taskFilesCollection,
      /activeRoleTags/,
      "TaskFilesCollection must build activeRoleTags omitting empty roles",
    );

    // 5. Sidebar authoritative count sync
    assert.match(
      sidebar,
      /authoritativeTaskCount/,
      "FilesTabSidebar must sync Task files badge with authoritative query total",
    );

    // 6. Header casing & grid width
    assert.match(
      header,
      /uppercase tracking-\[0\.09em\]/,
      "FolderListHeader must enforce uppercase tracking on sort buttons",
    );
    assert.match(
      layout,
      /FOLDER_LIST_SIZE_WIDTH_PX = 112/,
      "layout.ts must set FOLDER_LIST_SIZE_WIDTH_PX to 112px for clean role breakdown",
    );
  });
});
