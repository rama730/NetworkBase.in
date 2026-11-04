import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Assignment panel, Hand in and Review (docs/superpowers/plans/2026-11-04-assignment-review-ux.md).
const source = (path: string) => readFileSync(path, "utf8");

test("1.8: a main assignment's title, instructions, priority, due date and points change only through Edit for everyone", async () => {
  const { assignmentWriteBlock } = await import("../../src/lib/organizations/assignment-rules");
  const master = { isMaster: true, isCopy: false, handedIn: false, approved: false, groupCopy: false, orgTitle: "CSE 3B", actorRole: "owner" as const, actorIsHolder: false };
  for (const write of ["title", "description", "priority", "dueDate", "storyPoints"] as const) {
    assert.equal(assignmentWriteBlock(master, write), "Use Edit for everyone, so every copy changes.", write);
  }
  assert.equal(assignmentWriteBlock(master, "sprintId"), null, "the sprint already moves every copy");
});

test("1.8, 2.1, 1.12: Details shows a main assignment's fields read-only with Edit for everyone; no generic review box on a copy; the tab bar takes any number of tabs", () => {
  const details = source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx");
  assert.match(details, /const canEditSet = canEdit && !task\.assignmentId && !master;/);
  assert.match(details, /<MasterEditButton /);
  assert.match(details, /task\.reviewStatus === "pending" && !master && !task\.assignmentId \?/);
  const panel = source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx");
  assert.match(panel, /grid-flow-col auto-cols-fr/);
  assert.doesNotMatch(panel, /grid w-full grid-cols-4/);
});

test("1.10, 1.11, 1.9: a main assignment's Comments, Files and Subtasks tabs say what they are", () => {
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /MASTER_TAB_NOTE/);
  const notes = source("src/lib/organizations/assignment-rules.ts");
  assert.match(notes, /comments: "The brief and questions everyone with this assignment sees\."/);
  assert.match(notes, /files: "Materials\. Students open these read-only from their own copy\."/);
  assert.match(notes, /subtasks: "Steps\. A step added here goes to every copy\."/);
});

test("1.7: a main assignment's header chip says Draft, Scheduled, Open or Closed", async () => {
  const { masterChip } = await import("../../src/lib/organizations/assignment-rules");
  assert.deepEqual(masterChip({ publishedAt: null, publishAt: null, closedAt: null }), { label: "Draft", tone: "warn" });
  assert.deepEqual(masterChip({ publishedAt: null, publishAt: "2026-11-09T09:00:00Z", closedAt: null }), { label: "Scheduled", tone: "info" });
  assert.deepEqual(masterChip({ publishedAt: "2026-11-04T09:00:00Z", publishAt: null, closedAt: null }), { label: "Open", tone: "info" });
  assert.deepEqual(masterChip({ publishedAt: "2026-11-04T09:00:00Z", publishAt: null, closedAt: "2026-11-05T09:00:00Z" }), { label: "Closed", tone: "muted" });
});

test("1.2, 1.4, 1.14: the Assignment tab groups people by state, searches and sorts them, and knows who Remind will skip", async () => {
  const { rosterSections, filterRoster, remindSkips } = await import("../../src/lib/organizations/assignment-rules");
  const row = (label: string, state: string, extra: Record<string, unknown> = {}) => ({ copyId: label, label, members: [], state, late: false, approved: false, submittedAt: null, remindedAt: null, people: undefined, ...extra }) as never;
  const rows = [row("Zara", "submitted", { submittedAt: "2026-11-04T10:00:00Z", late: true }), row("Asha", "submitted", { submittedAt: "2026-11-04T08:00:00Z" }), row("Ravi", "returned"),
    row("Kiran", "in_progress", { remindedAt: new Date(Date.now() - 3600e3).toISOString() }), row("Meena", "not_started", { remindedAt: new Date(Date.now() - 20 * 3600e3).toISOString() }),
    row("John", "missing"), row("Priya", "done", { approved: true }), row("Dev", "done"), row("Sam", "excused"), row("Team A", "in_progress", { people: [{ id: "u1", name: "Ravi Kumar", lead: true }] })];
  assert.deepEqual(rosterSections(rows, "name").map((s) => [s.key, s.title, s.rows.map((r) => r.label)]), [
    ["submitted", "Waiting for review", ["Asha", "Zara"]], ["returned", "Returned", ["Ravi"]], ["in_progress", "In progress", ["Kiran", "Team A"]],
    ["not_started", "Not started", ["Meena"]], ["missing", "Missing", ["John"]], ["approved", "Approved", ["Priya"]], ["done", "Done", ["Dev"]], ["excused", "Excused", ["Sam"]],
  ]);
  assert.deepEqual(rosterSections(rows, "handedIn")[0]!.rows.map((r) => r.label), ["Asha", "Zara"], "oldest hand-in first");
  assert.deepEqual(filterRoster(rows, { query: "ravi", lateOnly: false }).map((r) => r.label), ["Ravi", "Team A"], "names inside a team match too");
  assert.deepEqual(filterRoster(rows, { query: "", lateOnly: true }).map((r) => r.label), ["Zara"]);
  assert.equal(remindSkips(rows), 1, "Kiran was reminded an hour ago; Meena twenty hours ago can be reminded");
});

test("1.1, 1.3, 1.10: admins open a main assignment on its Assignment tab, with the roster's tools and the class questions in it", () => {
  const panel = source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx");
  assert.match(panel, /const showAssignmentTab = canEdit && isAssignmentMaster\(task\);/);
  assert.match(panel, /\.\.\.\(showAssignmentTab \? \[\{ id: "assignment" as const, label: "Assignment"/);
  assert.match(panel, /<AssignmentManageSection orgId=\{resource\.task\.projectId\} masterId=\{resource\.task\.id\} \/>/);
  assert.doesNotMatch(source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx"), /AssignmentManageSection/);
  const manage = source("src/components/organizations/AssignmentsPanel.tsx").split("export function AssignmentManageSection")[1] ?? "";
  assert.match(manage, /<AssignmentRoster /);
  assert.doesNotMatch(manage, /RosterDialog|Full roster|Hide class questions/);
  assert.match(manage, /id="assignment-questions-heading"/);
  assert.equal(existsSync("src/components/organizations/AssignmentGlance.tsx"), false);
  const roster = source("src/components/organizations/AssignmentRoster.tsx");
  for (const words of ["Approve selected", "Return selected", "Remind selected", "Give to…", "Add step", "Change decision", "Un-excuse", "Search people", "Late only", "Not in a group"]) assert.ok(roster.includes(words), words);
});
