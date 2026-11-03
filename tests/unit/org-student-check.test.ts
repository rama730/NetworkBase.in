import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The student check, 4 November 2026 (docs/superpowers/plans/2026-11-04-org-student-check.md).
const source = (path: string) => readFileSync(path, "utf8");

test("student check 4: a member's document keeps its title, header and list; Report sits beside them", () => {
  const tab = source("src/components/workspaces/tabs/DocTab.tsx");
  assert.doesNotMatch(tab, /inPlaceBanner=\{!canEdit && reportDocId/, "the report menu is not the child-workspace banner");
  assert.match(tab, /reportMenu=\{!canEdit && reportDocId/);
  const viewer = source("src/components/workspaces/doc/WorkspaceDocViewer.tsx");
  assert.match(viewer, /reportMenu\?: React\.ReactNode/);
  assert.match(viewer, /\{reportMenu\}/);
});

test("student check 5: a copy's set fields are read-only, Submit is the only way to Completed, and one person's copy keeps its person", () => {
  const details = source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx");
  assert.match(details, /const canEditSet = canEdit && !task\.assignmentId;/);
  assert.match(details, /const copyKeepsPerson = Boolean\(task\.assignmentId\) && !task\.teamName;/);
  assert.match(details, /aria-label=\{titlePresentation\.ariaLabel/);
  assert.match(details, /disabled=\{!canEditSet \|\| isMutating\}\s*rows=\{1\}/, "the title");
  assert.match(details, /id="task-due-date"[\s\S]{0,300}disabled=\{!canEditSet \|\| isMutating\}/, "the due date");
  assert.match(details, /TASK_WORKFLOW_STATUSES\.filter\(\(s\) => !\(task\.assignmentId && s === "done"\)\)/);
  assert.match(details, /disabled=\{!canEdit \|\| copyKeepsPerson \|\| isMutating\}\s*className="[^"]*"\s*aria-label="Select assignee"/);
  assert.match(source("src/components/workspaces/v2/tasks/KanbanBoard.tsx"), /!\(c\.done && task\.assignmentId\)/);
});

test("student check 6: a refused edit is taken back from every cached list, not only the ones snapshotted", () => {
  const hook = source("src/hooks/useTaskSurfaceMutations.ts");
  assert.match(hook, /restoreSnapshots\(snapshots\);[\s\S]{0,300}patchWorkspaceTaskCaches\(queryClient, projectId, previousTask\);\s*onTaskChange\(previousTask\);/);
});

test("student check 7: members never see New task on an organization's board", () => {
  const tab = source("src/components/workspaces/v2/TasksTab.tsx");
  assert.match(tab, /const canCreateTasks = canEditTasks && \(!orgId \|\| canManageWorkflow\);/);
  assert.match(tab, /\{\/\* New Task \*\/\}\s*\{canCreateTasks \? \(/);
});

test("student check 12: What's allowed reads right for students on posts, workspaces and files", async () => {
  const { PERMISSION_AREAS } = await import("../../src/lib/organizations/permission-labels");
  const row = (action: string) => PERMISSION_AREAS.flatMap((a) => a.rows).find((r) => r.action === action)!;
  assert.equal(row("read_posts").words?.own, "Posts meant for them");
  assert.equal(row("projects_tab").words?.own, "Shared ones and their own");
  assert.equal(row("manage_files").label, "Upload and change the organization’s files");
  assert.match(source("src/components/organizations/OrgSettingsSections.tsx"), /row\.words\?\.\[grant\] \?\? GRANT_WORDS\[grant\] \?\? '—'/);
});

test("student check 13: Privacy in organization Settings says organization and points to account settings for deletion", () => {
  const tab = source("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
  assert.match(tab, /not everyone in this \$\{organization \? "organization" : "workspace"\}/);
  assert.match(tab, /<LegalAndDataRightsSection inWorkspace \/>/);
  assert.match(source("src/components/settings/LegalAndDataRightsSection.tsx"), /href="\/settings#settings-delete-account"/);
});

test("student check 15: small words — reviewers by role, one helper line, Today's empty line, a plain hand-in error", () => {
  assert.match(source("src/components/organizations/HandInSection.tsx"), /Reviewed by \$\{h\.reviewers\}/);
  assert.match(source("src/app/actions/assignments.ts"), /reviewers: `\$\{roles\.owner\} or \$\{roles\.admin\}`/);
  assert.doesNotMatch(source("src/components/organizations/ClassQuestions.tsx"), /Everyone with this assignment sees this/);
  assert.match(source("src/components/organizations/OrgOverviewParts.tsx"), /'Nothing due in the next 2 days'/);
  assert.match(source("src/components/organizations/HandInSection.tsx"), /!\/React error\|Server Components\/\.test\(result\.error\)/);
});

test("student check 18, 22: deleting an assignment says what goes with it and who has started", async () => {
  const { deleteAssignmentWarning } = await import("../../src/lib/organizations/assignment-rules");
  assert.equal(deleteAssignmentWarning({ total: 1, in_progress: 1, returned: 0, missing: 0 }), "1 copy goes with it, with its class questions and comments. 1 person has started.");
  assert.equal(deleteAssignmentWarning({ total: 30, in_progress: 0, returned: 0, missing: 0 }), "30 copies go with it, with their class questions and comments.");
  assert.equal(deleteAssignmentWarning({ total: 0, in_progress: 0, returned: 0, missing: 0 }), null);
  assert.match(source("src/components/organizations/AssignmentsPanel.tsx"), /description: deleteAssignmentWarning\(row\.counts\)/);
});

test("student check 19: Create assignment explains itself instead of saying Create a new task", () => {
  assert.match(source("src/components/workspaces/v2/tasks/CreateTaskModal.tsx"), /\{many \? "Everyone it goes to gets their own copy\." : "Create a new task"\}/);
});

test("student check 21: the hand-in due time names its zone", () => {
  assert.match(source("src/components/organizations/HandInSection.tsx"), /minute: '2-digit', timeZoneName: 'short' \}\)/);
});

test("student check 17, 24: Publish confirms how many copies went out, and warns when nobody got one", () => {
  const panel = source("src/components/organizations/AssignmentsPanel.tsx");
  assert.match(panel, /Published \$\{title\.trim\(\)\}: \$\{result\.copies\}/);
  assert.match(panel, /if \(publish && result\.copies === 0\) toast\.warning\(/);
});

test("live after deploy: lists from SQL come back as JSON, because production reads Postgres arrays as text (fetch_types off)", () => {
  assert.match(source("src/app/actions/assignments.ts"), /\(SELECT jsonb_agg\(jsonb_build_object\('nodeId', f->>'nodeId', 'name', f->>'name', 'size', n\.size\)\) FROM assignment_submissions/);
  assert.match(source("src/app/actions/organizations.ts"), /\(SELECT to_jsonb\(array_agg\(s\.name ORDER BY s\.name\)\) FROM/);
  // Every array_agg that comes back whole (not one element with [1]) goes through to_jsonb.
  for (const file of ["src/app/actions/assignments.ts", "src/app/actions/organizations.ts"]) {
    assert.doesNotMatch(source(file), /\(SELECT array_agg\(/, file);
  }
});

test("live after deploy: a handed-in copy's panel chip reads In review, not Completed", () => {
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /<TaskStatusBadge status=\{resource\.task\.status\} reviewStatus=\{resource\.task\.reviewStatus\} \/>/);
});

test("live after deploy: no Choose file while a hand-in waits for review or is approved", () => {
  const hand = source("src/components/organizations/HandInSection.tsx");
  assert.match(hand, /const canAttach = Boolean\(onUploadFiles\) && h\.state !== 'submitted' && !h\.approved/);
  assert.match(hand, /\{canAttach \? \(\s*<label/);
});

test("live loop 30–33: the review queue labels its Return box, drops a stale count, confirms each decision, and defaults Fix by to a sensible time", async () => {
  const { defaultFixBy } = await import("../../src/lib/organizations/assignment-rules");
  const fixBy = defaultFixBy(new Date(2026, 10, 4, 2, 43));
  assert.deepEqual([fixBy.getFullYear(), fixBy.getMonth(), fixBy.getDate(), fixBy.getHours(), fixBy.getMinutes()], [2026, 10, 7, 23, 59]);
  const panel = source("src/components/organizations/AssignmentsPanel.tsx");
  assert.match(panel, /aria-label=\{`What should \$\{current\.who\} change\?`\}/);
  assert.match(panel, /aria-label="Fix by"/);
  assert.match(panel, /setFixBy\(toLocalInput\(defaultFixBy\(\)\)\)/);
  assert.match(panel, /setTotal\(\(t\) => Math\.max\(0, t - 1\)\)/);
  assert.match(panel, /toast\.success\(decision === 'approve' \? `Approved \$\{current\.who\}’s \$\{current\.title\}\.` : `Returned \$\{current\.title\} to \$\{current\.who\}\.`\)/);
});

test("live loop 33: the roster's Return dialog defaults Fix by to 11:59 PM three days on", () => {
  assert.match(source("src/components/organizations/AssignmentDialogs.tsx"), /\.slice\(0, 10\)\}T23:59`\)/);
});

test("live loop 34: open work lists each file with Remove, wired to the panel's unlink", () => {
  const hand = source("src/components/organizations/HandInSection.tsx");
  assert.match(hand, /aria-label=\{`Remove \$\{name\}`\}/);
  assert.match(hand, /canAttach && onRemoveFile \?/);
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /onRemoveFile=\{resource\.fileMutations\.unlinkAttachment\}/);
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx"), /onUploadFiles=\{onUploadFiles\} onRemoveFile=\{onRemoveFile\}/);
});
