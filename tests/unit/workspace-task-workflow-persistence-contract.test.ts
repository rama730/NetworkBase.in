import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("task-board workflow is hydrated and synchronized through its dedicated column resource", () => {
    const taskTab = readProjectFile("src/components/workspaces/v2/TasksTab.tsx");
    const action = readProjectFile("src/app/actions/workspace/workflow.ts");
    const subscriptions = readProjectFile("src/lib/realtime/subscriptions.ts");
    const schema = readProjectFile("src/lib/db/schema/index.ts");
    const migration = readProjectFile("drizzle/0008_tasks_sprints.sql");

    assert.match(taskTab, /getWorkspaceWorkflowColumnsAction/);
    assert.match(taskTab, /subscribeBroadcast\(liveTopics\.tasks\(projectId\)/);
    assert.match(taskTab, /event === "workflow\.changed"/);
    assert.match(taskTab, /scheduleWorkflowRefresh/);
    assert.match(taskTab, /if \(!result\.success \|\| !result\.columns\)/);
    assert.match(taskTab, /normalizeAssignableMembers\(members\)/);
    assert.match(action, /updateWorkspaceWorkflowColumnsAction/);
    assert.match(schema, /workspaceWorkflowColumns/);
    assert.match(subscriptions, /tasks: \(workspaceId: string\) => `live:tasks:/);
    assert.match(migration, /CREATE TABLE public\.workspace_workflow_columns /);
    assert.match(migration, /CREATE POLICY workspace_workflow_columns_read [^\n]*app_private\.nb_workspace_tab_visible\(workspace_id, 'tasks'::text\)/);
});

test("workflow columns keep four default categories while allowing two project-specific sections", () => {
    const taskTab = readProjectFile("src/components/workspaces/v2/TasksTab.tsx");
    const action = readProjectFile("src/app/actions/workspace/workflow.ts");
    const board = readProjectFile("src/components/workspaces/v2/tasks/KanbanBoard.tsx");
    const realtime = readProjectFile("src/hooks/useRealtimeTasks.ts");
    const schema = readProjectFile("src/lib/db/schema/index.ts");
    const migration = readProjectFile("drizzle/0008_tasks_sprints.sql");

    assert.match(action, /\.min\(4\)\.max\(6\)/);
    assert.match(action, /createWorkspaceWorkflowColumnAction/);
    assert.match(action, /deleteWorkspaceWorkflowColumnAction/);
    assert.match(taskTab, /Add column/);
    assert.match(taskTab, /<Dialog/);
    assert.doesNotMatch(taskTab, /window\.prompt/);
    assert.match(board, /workflowColumnId/);
    assert.match(board, /activationConstraint: \{ distance: 8 \}/);
    assert.match(board, /autoScroll=\{\{/);
    assert.match(board, /acceleration: 12/);
    assert.match(board, /collisionDetection=\{closestCenter\}/);
    assert.match(board, /adjustScale=\{false\}/);
    assert.match(board, /activeTaskWidth/);
    assert.match(board, /<TaskCard task=\{activeTask\} showStatus=\{false\} \/>/);
    assert.match(board, /flex items-start gap-4 overflow-x-auto/);
    assert.match(board, /getBoundingClientRect/);
    assert.match(board, /buildTaskPreviewColumns/);
    assert.match(board, /previewMove/);
    assert.doesNotMatch(board, /DropIndicator/);
    assert.match(board, /onTaskDragStateChange/);
    const dragOver = board.slice(board.indexOf("function onDragOver"), board.indexOf("async function onDragEnd"));
    assert.doesNotMatch(dragOver, /setTasks/);
    assert.match(dragOver, /setPreviewMove/);
    const dragCancel = board.slice(board.indexOf("function onDragCancel"), board.indexOf("const scrollContainerRef"));
    assert.doesNotMatch(dragCancel, /restoreDraggedTask/);
    assert.match(realtime, /deferredTaskId/);
    assert.match(schema, /workspaceWorkflowColumns/);
    assert.match(schema, /workflowColumnId/);
    assert.match(migration, /CREATE TABLE public\.workspace_workflow_columns /);
    assert.match(migration, /workflow_column_id/);
});
