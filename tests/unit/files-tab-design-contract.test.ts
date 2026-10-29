import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Files Tab Design Specification Conformance Contract (Section 23 & Sections 03, 04, 05, 10)", async (t) => {
  const filesTabDir = path.join(process.cwd(), "src/components/projects/v2/files-tab");
  const folderDir = path.join(filesTabDir, "folder");
  const quickOpenDir = path.join(filesTabDir, "quick-open");
  const uploadDir = path.join(filesTabDir, "upload");
  const pickerDir = path.join(filesTabDir, "picker");
  const fileDir = path.join(filesTabDir, "file");
  const breadcrumbDir = path.join(filesTabDir, "breadcrumb");
  const uiDir = path.join(process.cwd(), "src/components/ui");

  const folderListView = fs.readFileSync(path.join(folderDir, "FolderListView.tsx"), "utf-8");
  const folderListRow = fs.readFileSync(path.join(folderDir, "FolderListRow.tsx"), "utf-8");
  const folderListHeader = fs.readFileSync(path.join(folderDir, "FolderListHeader.tsx"), "utf-8");
  const folderListStates = fs.readFileSync(path.join(folderDir, "FolderListStates.tsx"), "utf-8");
  const workspaceHeader = fs.readFileSync(path.join(filesTabDir, "FilesHeader.tsx"), "utf-8");
  const sidebar = fs.readFileSync(path.join(filesTabDir, "FilesTabSidebar.tsx"), "utf-8");
  const openInIdeButton = fs.readFileSync(path.join(filesTabDir, "OpenInIdeButton.tsx"), "utf-8");
  const quickOpenDialog = fs.readFileSync(path.join(quickOpenDir, "QuickOpenDialog.tsx"), "utf-8");
  const revisionModal = fs.readFileSync(path.join(uiDir, "RevisionControlModal.tsx"), "utf-8");
  const filesTabMain = fs.readFileSync(path.join(filesTabDir, "FilesTabMain.tsx"), "utf-8");
  const uploadModal = fs.readFileSync(path.join(uploadDir, "FilesTabUploadModal.tsx"), "utf-8");
  const taskSearchPicker = fs.readFileSync(path.join(pickerDir, "TaskSearchPicker.tsx"), "utf-8");
  const multiAttachmentPicker = fs.readFileSync(path.join(pickerDir, "MultiAttachmentPicker.tsx"), "utf-8");
  const taskLinkPopover = fs.readFileSync(path.join(filesTabDir, "TaskLinkPopover.tsx"), "utf-8");
  const fileTransfers = fs.readFileSync(path.join(filesTabDir, "FileTransfers.tsx"), "utf-8");
  const fileTypeChip = fs.readFileSync(path.join(filesTabDir, "FileTypeChip.tsx"), "utf-8");
  const breadcrumbBar = fs.readFileSync(path.join(breadcrumbDir, "BreadcrumbBar.tsx"), "utf-8");
  const versionHistoryPanel = fs.readFileSync(path.join(fileDir, "FileVersionHistoryPanel.tsx"), "utf-8");
  const taskFilesCollection = fs.readFileSync(path.join(filesTabDir, "TaskFilesCollection.tsx"), "utf-8");

  await t.test("Strict zero rounded-full controls across interactive files-tab components", () => {
    assert.doesNotMatch(folderListView, /rounded-full/, "FolderListView must not have rounded-full controls");
    assert.doesNotMatch(folderListRow, /rounded-full/, "FolderListRow must not have rounded-full controls");
    assert.doesNotMatch(folderListHeader, /rounded-full/, "FolderListHeader must not have rounded-full controls");
    assert.doesNotMatch(workspaceHeader, /rounded-full/, "FilesHeader must not have rounded-full controls");
    assert.doesNotMatch(sidebar, /rounded-full/, "FilesTabSidebar must not have rounded-full controls");
    assert.doesNotMatch(openInIdeButton, /rounded-full/, "OpenInIdeButton must not have rounded-full controls");
    assert.doesNotMatch(quickOpenDialog, /rounded-full/, "QuickOpenDialog must not have rounded-full controls");
    assert.doesNotMatch(revisionModal, /rounded-full/, "RevisionControlModal must not have rounded-full controls");
    assert.doesNotMatch(filesTabMain, /rounded-full/, "FilesTabMain must not have rounded-full controls");
    assert.doesNotMatch(uploadModal, /rounded-full/, "FilesTabUploadModal must not have rounded-full controls");
    assert.doesNotMatch(versionHistoryPanel, /rounded-full/, "FileVersionHistoryPanel must not have rounded-full controls");
    assert.doesNotMatch(taskFilesCollection, /rounded-full/, "TaskFilesCollection must not have rounded-full controls");
  });

  await t.test("Strict zero raw zinc-* color token leaks across core files-tab components", () => {
    const zincRegex = /(?:text|bg|border|divide|hover:bg|dark:text|dark:bg|dark:border|dark:hover:bg)-zinc-\d+/;

    assert.doesNotMatch(folderListView, zincRegex, "FolderListView must have zero raw zinc token leaks");
    assert.doesNotMatch(folderListRow, zincRegex, "FolderListRow must have zero raw zinc token leaks");
    assert.doesNotMatch(folderListHeader, zincRegex, "FolderListHeader must have zero raw zinc token leaks");
    assert.doesNotMatch(folderListStates, zincRegex, "FolderListStates must have zero raw zinc token leaks");
    assert.doesNotMatch(workspaceHeader, zincRegex, "FilesHeader must have zero raw zinc token leaks");
    assert.doesNotMatch(sidebar, zincRegex, "FilesTabSidebar must have zero raw zinc token leaks");
    assert.doesNotMatch(openInIdeButton, zincRegex, "OpenInIdeButton must have zero raw zinc token leaks");
    assert.doesNotMatch(quickOpenDialog, zincRegex, "QuickOpenDialog must have zero raw zinc token leaks");
    assert.doesNotMatch(revisionModal, zincRegex, "RevisionControlModal must have zero raw zinc token leaks");
    assert.doesNotMatch(filesTabMain, zincRegex, "FilesTabMain must have zero raw zinc token leaks");
    assert.doesNotMatch(uploadModal, zincRegex, "FilesTabUploadModal must have zero raw zinc token leaks");
    assert.doesNotMatch(taskSearchPicker, zincRegex, "TaskSearchPicker must have zero raw zinc token leaks");
    assert.doesNotMatch(multiAttachmentPicker, zincRegex, "MultiAttachmentPicker must have zero raw zinc token leaks");
    assert.doesNotMatch(taskLinkPopover, zincRegex, "TaskLinkPopover must have zero raw zinc token leaks");
    assert.doesNotMatch(fileTransfers, zincRegex, "FileTransfers must have zero raw zinc token leaks");
    assert.doesNotMatch(fileTypeChip, zincRegex, "FileTypeChip must have zero raw zinc token leaks");
    assert.doesNotMatch(breadcrumbBar, zincRegex, "BreadcrumbBar must have zero raw zinc token leaks");
    assert.doesNotMatch(versionHistoryPanel, zincRegex, "FileVersionHistoryPanel must have zero raw zinc token leaks");
    assert.doesNotMatch(taskFilesCollection, zincRegex, "TaskFilesCollection must have zero raw zinc token leaks");
  });

  await t.test("Strict zero raw blue-* and indigo-* color token leaks across core files-tab components", () => {
    const blueIndigoRegex = /(?:text|bg|border|ring)-(?:blue|indigo)-\d+/;

    assert.doesNotMatch(folderListView, blueIndigoRegex, "FolderListView must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(folderListRow, blueIndigoRegex, "FolderListRow must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(workspaceHeader, blueIndigoRegex, "FilesHeader must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(sidebar, blueIndigoRegex, "FilesTabSidebar must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(openInIdeButton, blueIndigoRegex, "OpenInIdeButton must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(quickOpenDialog, blueIndigoRegex, "QuickOpenDialog must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(revisionModal, blueIndigoRegex, "RevisionControlModal must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(uploadModal, blueIndigoRegex, "FilesTabUploadModal must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(taskSearchPicker, blueIndigoRegex, "TaskSearchPicker must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(multiAttachmentPicker, blueIndigoRegex, "MultiAttachmentPicker must have zero raw blue/indigo token leaks");
    assert.doesNotMatch(taskFilesCollection, blueIndigoRegex, "TaskFilesCollection must have zero raw blue/indigo token leaks");
  });

  await t.test("All 6 standard file row actions are present in FolderListView", () => {
    assert.match(folderListView, />\s*Details\s*<\/DropdownMenuItem>/, "Details action must be present");
    assert.match(folderListView, />\s*Edit\s*<\/DropdownMenuItem>/, "Edit action must be present");
    assert.match(folderListView, />\s*Upload revision…\s*<\/DropdownMenuItem>/, "Upload revision action must be present");
    assert.match(folderListView, />\s*Attach task…\s*<\/DropdownMenuItem>/, "Attach task action must be present");
    assert.doesNotMatch(folderListView, /Use as a doc/, "docs are added from the Docs tab only");
    assert.match(folderListView, />\s*Link the task\s*<\/DropdownMenuItem>/, "Link the task action must be present");
    assert.match(folderListView, />\s*Rename it\s*<\/DropdownMenuItem>/, "Rename it action must be present");
  });

  await t.test("Toolbar Section 23 primary actions and modals mounted in FolderListView", () => {
    // Primary upload and new folder actions in the toolbar slot
    assert.match(folderListView, /<FilesHeaderSlot slot="actions">/, "Toolbar actions slot must be used");
    assert.match(folderListView, /Upload/, "Upload button must be rendered in toolbar");
    assert.match(folderListView, /New folder/, "New folder button must be rendered in toolbar");

    // Task picker and revision modal integration
    assert.match(folderListView, /<TaskSearchPicker/, "TaskSearchPicker must be mounted for Attach task action");
    assert.match(folderListView, /<RevisionControlModal/, "RevisionControlModal must be mounted for Upload revision action");
  });

  await t.test("RepositorySync uses one progressive, state-driven GitHub workflow", () => {
    const gitHubSyncWorkspace = fs.readFileSync(path.join(filesTabDir, "RepositorySync.tsx"), "utf-8");

    assert.match(gitHubSyncWorkspace, /Connect GitHub|Restore GitHub access/, "Authorization state must have one clear next step");
    assert.match(gitHubSyncWorkspace, /Permissions and data access/, "Permissions must remain available through progressive disclosure");
    assert.match(gitHubSyncWorkspace, /Review selection/, "Connected state must lead with a safe review action");
    assert.match(gitHubSyncWorkspace, /Incoming changes/, "Incoming changes must remain available as a secondary action");
    assert.match(gitHubSyncWorkspace, /Last synchronization completed/, "Connected state must show one concise activity summary");
    assert.match(gitHubSyncWorkspace, /Review selection/, "Publish configuration follows an explicit review of the selection");
    assert.match(gitHubSyncWorkspace, /Team GitHub access/, "Attribution disclosure must show member account connection state");
    assert.match(gitHubSyncWorkspace, /Not linked/, "Unlinked members must be identifiable without exposing private credentials");
  });

  await t.test("GitHub header distinguishes a project connection from the current user's authorization", () => {
    const githubActions = fs.readFileSync(path.join(process.cwd(), "src/app/actions/github-sync.ts"), "utf-8");
    const gitHubSyncWorkspace = fs.readFileSync(path.join(filesTabDir, "RepositorySync.tsx"), "utf-8");

    assert.match(githubActions, /authorized: Boolean\(token\)/, "Header status must report current-user GitHub authorization");
    assert.match(workspaceHeader, /GitHub needs access/, "Header must not show a stale branch as ready when access is missing");
    assert.match(gitHubSyncWorkspace, /Publication/, "Publication workflow must remain present");
    assert.match(gitHubSyncWorkspace, /Change sync destination/, "Repository destination changes must use the dialog");
    assert.doesNotMatch(gitHubSyncWorkspace, /--surface-accent/, "GitHub primary actions must not use undefined surface-accent variables");
    assert.match(gitHubSyncWorkspace, /const primaryButton/, "Primary actions must not inherit neutral button color utilities");
  });
});
