import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("task panel listens to its task row and exposes connection state", () => {
  const resource = read("src/lib/realtime/task-resource.ts");
  const hook = read("src/hooks/useTaskPanelResource.ts");
  assert.match(resource, /kind: "task"/);
  assert.match(resource, /table: "tasks"/);
  assert.match(hook, /setIsResourceConnected\(true\)/);
  assert.match(hook, /if \(event\.kind === "task"\)/);
  assert.match(hook, /void loadTask\(\)/);
  assert.match(resource, /generation/);
  assert.match(resource, /entry\.generation !== generation/);
});

test("an open task panel is a working link: its drawer params are in the URL", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");
  const hook = read("src/hooks/useTaskPanelResource.ts");
  const links = read("src/app/actions/files/links.ts");
  const fileMutations = read("src/hooks/useTaskFileMutations.ts");

  assert.match(taskTab, /nextParams\.set\("drawerId", normalized\.id\)/);
  assert.match(taskTab, /router\.push\(nextUrl, \{ scroll: false \}\);/);
  // Closing still removes them.
  assert.match(taskTab, /"drawerType",\s*"drawerId",\s*"panelTab",/);
  assert.match(hook, /countsFromTask/);
  assert.match(hook, /queryClient\.fetchQuery/);
  assert.doesNotMatch(hook, /countTaskAttachments/);
  assert.doesNotMatch(hook, /task\.status === "done"/);
  assert.doesNotMatch(fileMutations, /table: "task_node_links"/);
  assert.match(links, /getTaskAttachments\(projectId: string, taskId: string\)/);
});

test("workspace task handoff opens the task panel without leaking drawer IDs into the URL", () => {
  const workspaceTasks = read("src/components/my-work/MyWorkTasksTab.tsx");
  const dashboard = read(
    "src/components/projects/dashboard/ProjectDashboardClient.tsx",
  );
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");

  assert.match(workspaceTasks, /setMyWorkTaskHandoff/);
  assert.match(workspaceTasks, /router\.push\(/);
  assert.doesNotMatch(workspaceTasks, /drawerType=task|drawerId=/);
  assert.match(dashboard, /myWorkInitialTaskId/);
  assert.match(taskTab, /openTask\(localTask, initialPanelTab, true\)/);
});

test("task panel close is a single deterministic URL replacement", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");

  assert.match(taskTab, /const isTaskPanelClosingRef = useRef\(false\)/);
  assert.match(taskTab, /if \(isTaskPanelClosingRef\.current\) return;/);
  assert.match(taskTab, /isTaskPanelClosingRef\.current = true;/);
  assert.match(taskTab, /router\.replace\(nextUrl, \{ scroll: false \}\);/);
  assert.doesNotMatch(taskTab, /router\.back\(\)/);
  assert.match(taskTab, /if \(isTaskPanelClosingRef\.current\) return;\s*if \(\s*!initialOpenTaskId \|\|/s);
});

test("task panels no longer mount an activity surface or query", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const hook = read("src/hooks/useTaskPanelResource.ts");

  assert.doesNotMatch(panel, /ActivityTab|id: "activity"/);
  assert.doesNotMatch(hook, /getProjectTaskActivityAction|loadActivity/);
});

test("nested task links reach comment and file targets", () => {
  const taskTab = read("src/components/projects/v2/TasksTab.tsx");
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const comments = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  );
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  assert.match(taskTab, /preserveNestedTarget/);
  assert.match(panel, /initialCommentId=\{initialCommentId\}/);
  assert.match(panel, /initialFileId=\{initialFileId\}/);
  assert.match(comments, /task-comment-\$\{initialCommentId\}/);
  assert.match(files, /CSS\.escape\(initialFileId\)/);
});

test("task comments use the shared ThreadRail primitive aligned with Updates tab while preserving task capabilities", () => {
  const comments = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/CommentsTab.tsx",
  );
  const updates = componentSource("src/components/projects/tabs/UpdatesTab.tsx");
  const threadRail = read(
    "src/components/ui/ThreadRail.tsx",
  );
  const composer = read(
    "src/components/projects/v2/tasks/components/MentionComposer.tsx",
  );
  const presence = read("src/hooks/usePresenceTyping.ts");
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");

  assert.match(comments, /from ["']@\/components\/ui\/ThreadRail["']/);
  assert.match(comments, /ThreadAvatarRail/);
  assert.match(comments, /ThreadRailBridge/);
  assert.match(updates, /from ["']@\/components\/ui\/ThreadRail["']/);
  assert.match(updates, /ThreadAvatarRail/);
  assert.match(updates, /ThreadRailBridge/);
  assert.match(threadRail, /export function ThreadAvatarRail/);
  assert.match(threadRail, /export function ThreadRailBridge/);
  assert.match(comments, /Back to all comments/);
  assert.match(comments, /View conversation/);
  assert.match(comments, /onToggleLike/);
  assert.match(comments, /MentionComposer/);
  assert.match(comments, /presenceStatus/);
  assert.doesNotMatch(comments, /isPresenceConnected/);
  assert.match(composer, /editorClassName/);
  assert.match(presence, /currentUserProfileRef/);

  // Updates tab alignment contract:
  assert.match(comments, /CornerDownRight/);
  assert.match(comments, /UserAvatar/);
  assert.doesNotMatch(comments, /rounded-full/);
  assert.match(panel, /currentUser=\{currentUser\}/);
  assert.match(comments, /ThreadRailBridge/);
  assert.match(comments, /incoming=\{!isFirst\}/);
  assert.match(comments, /outgoing=\{!isLast\}/);
  assert.match(comments, /\+ \{row\.hiddenCount\}/);

  // Mention autocomplete and discussion sorting contract:
  const autocomplete = read(
    "src/components/projects/v2/tasks/components/MentionAutocomplete.tsx",
  );
  assert.doesNotMatch(autocomplete, /createPortal/);
  assert.match(composer, /maxLeft/);
  assert.match(composer, /onDraftChange\?\.\(raw\)/);
  assert.match(composer, /triggerMention/);
  assert.match(comments, /sortOrder === "asc" \? timeA - timeB : timeB - timeA/);
});

test("subtasks tab adheres to precision drafting redesign with counts and filters without progress bars", () => {
  const subtasks = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/SubtasksTab.tsx",
  );

  assert.match(subtasks, /filter === "all"/);
  assert.match(subtasks, /filter === "open"/);
  assert.match(subtasks, /filter === "completed"/);
  assert.doesNotMatch(subtasks, /role="progressbar"/);
  assert.doesNotMatch(subtasks, /completionPercent/);
  assert.match(subtasks, /rounded-\[3px\]/);
  assert.match(subtasks, /rounded-\[5px\]/);
  assert.doesNotMatch(subtasks, /rounded-full/);
});

test("details tab supports Estimate with Fibonacci presets and clean un-carded drafting layout without progress bars, subtask card, or files section", () => {
  const details = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx",
  );

  assert.match(details, /Estimate/);
  assert.match(details, /\[1, 2, 3, 5, 8, 13\]/);
  assert.match(details, /storyPoints/);
  assert.match(details, /Created by/);
  assert.match(details, /Assignee/);
  assert.doesNotMatch(details, /role="progressbar"/);
  assert.doesNotMatch(details, /subtaskCount <= 8/);
  assert.doesNotMatch(details, /Subtasks/);
  assert.doesNotMatch(details, /Files & Assets/);
  assert.doesNotMatch(details, /files attached/);
  assert.doesNotMatch(details, /rounded-\[8px\] border border-border bg-card p-4/);
  assert.doesNotMatch(details, /rounded-full/);

  // Custom Dropdowns, Search Filter, Markdown, Due date & Autosave Telemetry
  assert.match(details, /DropdownMenu/);
  assert.match(details, /DropdownMenuTrigger/);
  assert.match(details, /DropdownMenuContent/);
  assert.match(details, /Search team members…/);
  assert.match(details, /ReactMarkdown/);
  assert.match(details, /isEditingDescription/);
  assert.match(details, /Save description/);
  assert.match(details, /\+1 Week/);
  assert.match(details, /\+2 Weeks/);
  assert.match(details, /Overdue/);
  assert.match(details, /Autosave status/);
  assert.match(details, /Saving…/);
  assert.match(details, /Saved/);

  // Click-to-copy Task Identifier in TaskDetailPanel
  const panel = read(
    "src/components/projects/v2/tasks/TaskDetailPanel.tsx",
  );
  assert.match(panel, /copiedTaskId/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /Click to copy task link/);
});

test("task file row implements two-row layout with flex-wrap overflow flowing", () => {
  const row = read(
    "src/components/projects/v2/tasks/components/TaskFileRow.tsx",
  );

  assert.match(row, /flex min-w-0 flex-1 flex-col justify-center gap-1/);
  assert.match(row, /flex flex-wrap items-center gap-1.5 min-w-0/);
  assert.match(row, /formatBytes\(node\.size\)/);
  assert.match(row, /getTaskFileAttributionLabel\(node\)/);
  assert.doesNotMatch(row, /rounded-full/);
});

test("task-file navigation preserves fileId until the file viewer hydrates", () => {
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  const filesRoot = read(
    "src/components/projects/v2/files-tab/FilesTabRoot.tsx",
  );
  const urlSync = read(
    "src/components/projects/v2/files-tab/hooks/useFilesTabUrlSync.ts",
  );

  assert.match(
    files,
    /tab=files&fileId=\$\{encodeURIComponent\(node\.id\)\}/,
  );
  assert.match(files, /usePathname/);
  assert.match(filesRoot, /suspendWrites: Boolean/);
  assert.match(filesRoot, /completeInitialFileResolution/);
  assert.match(urlSync, /suspended: options\.suspendWrites/);
});

test("task uploads preserve the selected intent and destination", () => {
  const files = read(
    "src/components/projects/v2/tasks/TaskDetailTabs/FilesTab.tsx",
  );
  const modal = read(
    "src/components/projects/v2/tasks/components/TaskFileUploadModal.tsx",
  );

  assert.match(
    modal,
    /onConfirm\(intent, destinationFolderId \?\? undefined\)/,
  );
  assert.match(modal, /onConfirm\(intent, versionNodeId\)/);
  assert.match(files, /intent === "deliverable" \? targetNodeId : undefined/);
  assert.match(
    files,
    /toast\.error\(feedbackError\(failed\.error \|\| "Couldn’t upload files", "Couldn’t upload files"\)\)/,
  );
  assert.match(files, /Array\.from\(dataTransfer\.files \|\| \[\]\)/);
});

test("task deletion confirmation is layered above the detail panel", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const confirmDialog = read("src/components/ui/ConfirmDialog.tsx");

  assert.match(panel, /overlayClassName="z-\[300\]/);
  assert.match(panel, /contentClassName="z-\[301\]"/);
  assert.match(confirmDialog, /overlayClassName=\{overlayClassName\}/);
  assert.match(confirmDialog, /contentClassName/);
});

test("task file move dialog is roomy and layered above the detail panel", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const row = read(
    "src/components/projects/v2/tasks/components/TaskFileRow.tsx",
  );
  const dialogs = read(
    "src/components/projects/v2/explorer/ExplorerDialogsHost.tsx",
  );

  assert.match(panel, /sm:w-\[580px\]/);
  assert.match(panel, /sm:max-w-\[580px\]/);
  assert.match(panel, /grid-cols-4/);
  assert.match(panel, /overflow-visible/);
  // Only phones may scroll the tab strip sideways.
  assert.doesNotMatch(panel, /(?<!max-md:)overflow-x-auto/);
  assert.match(dialogs, /overlayClassName="z-\[300\]/);
  assert.match(dialogs, /className="z-\[301\]/);
  assert.match(dialogs, /className="z-\[301\] flex max-h-\[88vh\] flex-col sm:max-w-\[460px\]/);
  assert.match(dialogs, /h-\[min\(58vh,28rem\)\]/);
  assert.doesNotMatch(row, /<Dialog/);
  assert.doesNotMatch(row, /onSelect=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setIsMoveModalOpen/);
});

test("task detail panel dimensions match the workspace drawer specification exactly", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");
  const workspaceDrawer = read("src/components/my-work/MyWorkDrawer.tsx");

  assert.match(workspaceDrawer, /sm:w-\[520px\]/);
  assert.match(workspaceDrawer, /sm:max-w-\[520px\]/);
  assert.match(panel, /sm:w-\[580px\]/);
  assert.match(panel, /sm:max-w-\[580px\]/);
});

