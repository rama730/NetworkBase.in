import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractLabel, composeAnnotation } from "@/lib/workspaces/task-file-label";

test("Task File Labels & Inline Editing Contract in Files Tab", async (t) => {
  const filesTabDir = path.join(
    process.cwd(),
    "src/components/workspaces/v2/files-tab",
  );
  const folderListRowSource = fs.readFileSync(
    path.join(filesTabDir, "folder/FolderListRow.tsx"),
    "utf-8",
  );
  const folderListViewSource = fs.readFileSync(
    path.join(filesTabDir, "folder/FolderListView.tsx"),
    "utf-8",
  );
  const taskFilesCollectionSource = fs.readFileSync(
    path.join(filesTabDir, "TaskFilesCollection.tsx"),
    "utf-8",
  );
  const collectionsActionSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/actions/files/collections.ts"),
    "utf-8",
  );
  const taskQuerySource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/files/task-file-collection-query.ts"),
    "utf-8",
  );

  await t.test("extractLabel and composeAnnotation handle labels and tags cleanly", () => {
    // Basic label
    assert.equal(
      extractLabel("I added the reference of the issue"),
      "I added the reference of the issue",
    );
    // Label with tags
    assert.equal(
      extractLabel("I added the reference of the issue #deliverable #v1"),
      "I added the reference of the issue",
    );
    // Null/undefined
    assert.equal(extractLabel(null), null);
    assert.equal(extractLabel(undefined), null);
    assert.equal(extractLabel(""), null);

    // composeAnnotation with new label and existing annotation containing tags
    assert.equal(
      composeAnnotation("Updated label", "Old label #working_file"),
      "Updated label #working_file",
    );
    // composeAnnotation clearing label but keeping tags
    assert.equal(
      composeAnnotation(null, "Old label #reference"),
      "#reference",
    );
    // composeAnnotation completely clearing when no tags
    assert.equal(
      composeAnnotation(null, "Old label"),
      null,
    );
  });

  await t.test("task-file-collection-query includes annotation in attachments CTE and search filter", () => {
    assert.match(
      taskQuerySource,
      /l\.annotation/,
      "taskFileAssociationsSql must select l.annotation",
    );
    assert.match(
      taskQuerySource,
      /NULL::text AS annotation/,
      "taskFileAssociationsSql legacy union branch must select NULL::text AS annotation",
    );
    assert.match(
      taskQuerySource,
      /strpos\(lower\(coalesce\(a\.annotation,\s*''\)\),\s*lower\(\$\{query\.slice\(0,\s*200\)\}\)\)/,
      "taskFileEntriesSql must search across a.annotation",
    );
  });

  await t.test("collections.ts includes annotation in TaskCollectionEntry and loads it from SQL rows", () => {
    assert.match(
      collectionsActionSource,
      /annotation\?:\s*string\s*\|\s*null;/,
      "TaskCollectionEntry must declare annotation?: string | null",
    );
    assert.match(
      collectionsActionSource,
      /annotation:\s*row\.annotation/,
      "loadEntries must map row.annotation onto entries",
    );
    assert.match(
      collectionsActionSource,
      /strpos\(lower\(coalesce\(a\.annotation,\s*''\)\),\s*lower\(\$\{query\}\)\)/,
      "getTaskFileGroups must search across a.annotation",
    );
  });

  await t.test("FolderListRow implements drafting label pill and keyboard-accessible inline editor", () => {
    assert.match(
      folderListRowSource,
      /taskLabel\?: string \| null;/,
      "FolderListRowProps must include taskLabel",
    );
    assert.match(
      folderListRowSource,
      /onTaskLabelChange\?:/,
      "FolderListRowProps must include onTaskLabelChange",
    );
    assert.match(
      folderListRowSource,
      /data-testid="folder-list-row-task-label"/,
      "FolderListRow must render data-testid='folder-list-row-task-label' for existing label",
    );
    assert.match(
      folderListRowSource,
      /data-testid="folder-list-row-label-editor"/,
      "FolderListRow must render data-testid='folder-list-row-label-editor' for inline editing",
    );
    assert.match(
      folderListRowSource,
      /data-testid="folder-list-row-add-label-btn"/,
      "FolderListRow must render data-testid='folder-list-row-add-label-btn' on hover when editable",
    );
    // Check drafting token compliance (no rounded-full, mono font for pill)
    assert.doesNotMatch(
      folderListRowSource,
      /data-testid="folder-list-row-task-label"[^>]*rounded-full/,
      "Label pill must not use rounded-full",
    );
    assert.match(
      folderListRowSource,
      /data-testid="folder-list-row-task-label"[\s\S]*?font-mono/,
      "Label pill must use font-mono typography",
    );
  });

  await t.test("FolderListView forwards taskLabels and provides 'Edit label…' menu item", () => {
    assert.match(
      folderListViewSource,
      /taskLabels\?: Record<string, string \| null>;/,
      "FolderListViewProps collection must include taskLabels",
    );
    assert.match(
      folderListViewSource,
      /onTaskLabelChange\?: \(node: FolderListRowNode, newLabel: string \| null\) => void;/,
      "FolderListViewProps collection must include onTaskLabelChange",
    );
    assert.match(
      folderListViewSource,
      /Edit label…/,
      "FolderListView renderMenu must include 'Edit label…'",
    );
  });

  await t.test("TaskFilesCollection wires optimistic label updates and searches file annotations", () => {
    assert.match(
      taskFilesCollectionSource,
      /taskLabels=\{taskLabels\}|taskLabels,\s*onTaskLabelChange/,
      "TaskFilesCollection must pass taskLabels and onTaskLabelChange to FolderListView",
    );
    assert.match(
      taskFilesCollectionSource,
      /updateTaskNodeLink\(taskId,\s*node\.id,\s*\{\s*annotation:\s*nextAnnotation\s*\}\)/,
      "TaskFilesCollection must call updateTaskNodeLink on label change",
    );
    assert.match(
      taskFilesCollectionSource,
      /queryClient\.setQueriesData/,
      "TaskFilesCollection must perform optimistic query cache update",
    );
    assert.match(
      taskFilesCollectionSource,
      /annotation.*toLowerCase\(\)\.includes\(q\)/,
      "TaskFilesCollection inline filter must test annotation",
    );
  });
});
