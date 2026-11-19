import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Live-fix phase 2 (problems 3–8, 10, 47, 48): one board, one form, one button.
const source = (path: string) => readFileSync(path, "utf8");

test("live-fix 3, 4: no Assignments box above the board, and + New offers Task", () => {
  const dashboard = source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");
  assert.doesNotMatch(dashboard, /<AssignmentsPanel/);
  assert.match(source("src/components/organizations/OrgHeaderParts.tsx"), /\{ kind: 'task', label: 'Task'/);
  assert.match(dashboard, /startCreate=\{newIntent === 'task' \|\| newIntent === 'assignment'\} startCreateKind=\{newIntent === 'assignment' \? 'assignment' : 'task'\}/);
  assert.match(source("src/components/organizations/OrgHeaderParts.tsx"), /\{ kind: 'assignment', label: 'Assignment'/, "board/review report §4");
  const search = source("src/app/actions/org-workspace.ts");
  assert.match(search, /title: `New task in \$\{scope\.title\}`/);
  assert.match(search, /\?tab=tasks&new=1/);
});

test("live-fix 3: drafts are published, scheduled, sent back or deleted from their own card", () => {
  const manage = source("src/components/organizations/AssignmentsPanel.tsx").split("export function AssignmentManageSection")[1] ?? "";
  for (const call of ["publishAssignmentAction", "scheduleAssignmentAction(row.masterId, null)", "deleteAssignmentAction"]) assert.ok(manage.includes(call), call);
  assert.match(manage, /Back to draft/);
});

test("board/review report §4: New has Task and Assignment tabs; Assigned to is people only in an organization", () => {
  const modal = source("src/components/workspaces/v2/tasks/CreateTaskModal.tsx");
  assert.match(modal, /<UnderlineTabs label="What are you creating\?"/);
  // Report 38.4 S2: the tabs are Task, the added types, then Assignment in an organization (moduleTabs).
  assert.match(modal, /const tabKeys = moduleTabs\(types, \{ assignment: Boolean\(renderMany\) \}\);/);
  assert.match(modal, /key === "assignment" \? "Assignment"/);
  assert.match(modal, /const choice = renderMany \? undefined : manyOptions\.find/);
  assert.match(modal, /\{manyOptions\.length && !renderMany \? \(/);
  assert.doesNotMatch(source("src/components/workspaces/v2/TasksTab.tsx"), /<AssignmentComposer/);
  const panel = source("src/components/organizations/AssignmentsPanel.tsx");
  assert.match(panel, /export function AssignmentFields/);
  assert.doesNotMatch(panel, /<option value="task">One person · a task<\/option>/, "the tabs switch kinds now");
  // Assignment form redesign (2026-11-09): the due day carries across too.
  assert.match(panel, /useEffect\(\(\) => \{ draftRef\.current\?\.\(\{ title, description, sprintId, dueDate: dueLocal\.slice\(0, 10\) \}\) \}, \[title, description, sprintId, dueLocal\]\)/);
});

test("live-fix 6: Assignments and Mine filters", () => {
  const filters = source("src/components/workspaces/v2/tasks/TaskFilters.tsx");
  assert.match(filters, /\{ value: "assignments", label: "Assignments", orgOnly: true \}/);
  assert.match(filters, /\{ value: "mine", label: "Mine", orgOnly: true \}/);
});

// Assignment flow decision 4 (2026-11-10) replaces live-fix 7: only an admin lifts a main card, and its drop never
// moves it; it opens Publish, Close or Reopen, or snaps back saying why (the rule is tested in assignment-flow).
test("assignment flow 4: a main card lifts for admins only, and its drop goes through the flow rule", () => {
  const board = source("src/components/workspaces/v2/tasks/KanbanBoard.tsx");
  assert.match(board, /master \? !!isLeader :/);
  assert.match(board, /const outcome = dropOutcome\(/);
  assert.match(board, /\(master && sameColumn\)/, "a main card is never reordered");
});

test("live-fix 8: a main assignment's panel hides Status, Section and Assignee", () => {
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx"), /isAssignmentMaster\(/);
});

test("live-fix 10: the board opens at its first column; only a column added by hand scrolls", () => {
  assert.match(source("src/components/workspaces/v2/tasks/KanbanBoard.tsx"), /prevWorkflowLengthRef\.current > 0 && workflow\.length > prevWorkflowLengthRef\.current/);
});

test("live-fix 47, 48: org search is labelled for the organization and grouped by kind", () => {
  const palette = source("src/components/layout/header/CommandPalette.tsx");
  assert.match(palette, /label: "this organization"/);
  assert.match(palette, /organization: onOrgPage/);
  const search = source("src/app/actions/org-workspace.ts");
  assert.match(search, /linked_node_id/);
  assert.doesNotMatch(search, /tab=assignments/);
});

test("isAssignmentMaster is the server's master rule", async () => {
  const { isAssignmentMaster } = await import("../../src/lib/workspaces/task-presentation");
  assert.equal(isAssignmentMaster({ kind: "assignment", assignmentId: null }), true);
  assert.equal(isAssignmentMaster({ kind: "assignment", assignmentId: "copy-of" }), false);
  assert.equal(isAssignmentMaster({ kind: "task", assignmentId: null }), false);
});

test("review fix: opening the panel keeps the card's assignment progress and From label", async () => {
  const { mergeTaskSurfaceRecords, normalizeTaskSurfaceRecord } = await import("../../src/lib/workspaces/task-presentation");
  const card = normalizeTaskSurfaceRecord({ id: "m", title: "Lab 1", kind: "assignment", assignmentProgress: { draft: false, closed: false, done: 3, total: 40, toReview: 1, excused: 0 }, fromLabel: "From CSE 3B", teamName: "Team A" });
  const detail = normalizeTaskSurfaceRecord({ id: "m", title: "Lab 1", kind: "assignment" });
  const merged = mergeTaskSurfaceRecords(card, detail);
  assert.deepEqual([merged.assignmentProgress?.done, merged.fromLabel, merged.teamName], [3, "From CSE 3B", "Team A"]);
});

test("review fix: New task's assignment fields use the organization's time zone", () => {
  assert.match(source("src/components/workspaces/v2/TasksTab.tsx"), /<AssignmentFields key=\{reuseFrom \?\? "new"\} orgId=\{orgId\} timeZone=\{orgTimeZone\} reuseFrom=\{reuseFrom\}/);
  assert.match(source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), /orgTimeZone=\{organization\?\.timeZone \?\? null\}/);
});

test("board/review report §4: the Assignment tab keeps every target the assignment has; a team workspace keeps its shared task", () => {
  const panel = source("src/components/organizations/AssignmentsPanel.tsx");
  for (const mode of ['"everyone"', '"role"', '"people"', '"teams"', '"each_child"', '"children"']) assert.ok(panel.includes(`value=${mode}`) || panel.includes(`'${mode.slice(1, -1)}'`), mode);
  assert.match(source("src/components/workspaces/v2/TasksTab.tsx"), /manyOptions=\{isChildProject && canManageWorkflow \? \[\{ value: "units"/);
});

test("board/review report §5: every “which kind” choice uses the profile's underline tabs, from one component", () => {
  const uses = (file: string) => (source(file).match(/<UnderlineTabs /g) ?? []).length;
  assert.equal(uses("src/components/profile/v2/ProfileTabs.tsx"), 1, "Overview · Portfolio");
  assert.equal(uses("src/components/workspaces/v2/tasks/CreateTaskModal.tsx"), 1, "Task · Assignment");
  // Sprint cleanup §2: one tab row (CO · Sprint inside a CO); One or Several is a small choice with the dates.
  assert.equal(uses("src/components/workspaces/v2/sprints/CreateSprintModal.tsx"), 1, "CO · Sprint inside a CO");
  assert.match(source("src/components/workspaces/v2/sprints/CreateSprintModal.tsx"), /role="radiogroup" aria-label="How many sprints"/);
  assert.doesNotMatch(source("src/components/ui/UnderlineTabs.tsx"), /bg-background/, "tabs take their surface's colour, so no band in dialogs");
});
