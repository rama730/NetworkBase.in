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

test("2.4, 2.6, 2.13: each hand-in state gets one box with its next step, and the button's words follow the state and the type", async () => {
  const { handInBox, handInButton } = await import("../../src/lib/organizations/assignment-rules");
  const base = { submissionType: "file", state: "not_started", approved: false, canSubmit: true, closed: false, late: false, excusedReason: null, returned: null, from: "CSE 3B", lateLabel: null, latest: null } as never;
  const h = (patch: Record<string, unknown>) => ({ ...(base as object), ...patch }) as never;
  assert.deepEqual(handInBox(base), { tone: "info", title: "Not handed in yet", lines: [], next: "Add your file below, then hand it in.", message: false });
  assert.equal(handInBox(h({ submissionType: "link" })).next, "Paste the link below, then hand it in.");
  assert.equal(handInBox(h({ submissionType: "none" })).next, "Mark it as done when you’ve finished.");
  assert.deepEqual(handInBox(h({ state: "returned", returned: { by: "Ms. Rao", reason: "Add tests.", fixBy: null } })), { tone: "danger", title: "Ms. Rao returned this", lines: ["Add tests."], next: "Make the changes, then hand it in again.", message: false });
  assert.deepEqual(handInBox(h({ state: "submitted", latest: { version: 2, at: "2026-11-04T10:00:00Z" }, late: true })).lines, ["Version 2 · Late · Waiting for review"]);
  assert.equal(handInBox(h({ state: "submitted", latest: { version: 1, at: "2026-11-04T10:00:00Z" } })).message, true, "a waiting file can't be replaced: ask instead");
  assert.equal(handInBox(h({ state: "submitted", submissionType: "text", latest: { version: 1, at: "2026-11-04T10:00:00Z" } })).next, "You can update it until it’s reviewed.");
  assert.deepEqual(handInBox(h({ state: "excused", excusedReason: "Medical leave" })), { tone: "muted", title: "You’re excused", lines: ["Medical leave"], next: "Nothing to hand in.", message: true });
  assert.deepEqual(handInBox(h({ closed: true, canSubmit: false })), { tone: "muted", title: "This assignment is closed", lines: [], next: "Message them if you need more time.", message: true });
  assert.deepEqual(handInBox(h({ state: "missing", canSubmit: false })), { tone: "danger", title: "The due date has passed", lines: [], next: "Ask CSE 3B if you need more time.", message: true });
  assert.equal(handInBox(h({ state: "missing", lateLabel: "Late work accepted" })).next, "Hand it in now. It will be marked Late.");
  assert.equal(handInBox(h({ state: "done", approved: true, latest: { version: 3, at: "2026-11-04T10:00:00Z" } })).title, "Approved");

  assert.deepEqual(handInButton(base), { show: true, label: "Hand in" });
  assert.deepEqual(handInButton(h({ state: "returned" })), { show: true, label: "Hand in again" });
  assert.deepEqual(handInButton(h({ state: "submitted" })), { show: false, label: "Hand in again" }, "no Replace while a file waits");
  assert.deepEqual(handInButton(h({ state: "submitted", submissionType: "link" })), { show: true, label: "Update hand-in" });
  assert.deepEqual(handInButton(h({ submissionType: "none" })), { show: true, label: "Mark as done" });
  assert.deepEqual(handInButton(h({ submissionType: "none", state: "done" })), { show: false, label: "Mark as done" });
  assert.equal(handInButton(h({ canSubmit: false })).show, false);
});

test("2.5, 2.14: the button says why it's off, and a link must be a web link", async () => {
  const { handInBlocked } = await import("../../src/lib/organizations/assignment-rules");
  assert.equal(handInBlocked({ submissionType: "file", files: 0 }), "Add a file to hand it in.");
  assert.equal(handInBlocked({ submissionType: "file", files: 1 }), null);
  assert.equal(handInBlocked({ submissionType: "link", link: "" }), "Add a link to hand it in.");
  assert.equal(handInBlocked({ submissionType: "link", link: "docs.google.com/x" }), "That isn’t a web link. Start it with https://");
  assert.equal(handInBlocked({ submissionType: "link", link: "https://docs.google.com/x" }), null);
  assert.equal(handInBlocked({ submissionType: "text", text: "  " }), "Write your answer to hand it in.");
  assert.equal(handInBlocked({ submissionType: "none" }), null);
});

test("2.11, 2.12: on a copy the properties fold under More details, and the card opens the private conversation or class questions", () => {
  const details = source("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx");
  assert.match(details, /<MoreDetails fold=\{Boolean\(task\.assignmentId\)\}>/);
  assert.match(details, /onOpenConversation=\{onOpenConversation\}/);
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /onOpenConversation=\{\(kind\) => \{ setConversation\(kind\); setActiveTab\("comments"\); \}\}/);
});

test("3.7, 3.8: Fix by defaults to the later of the due date and three days on; the queue searches and sorts", async () => {
  const { reviewFixBy, queueOrder } = await import("../../src/lib/organizations/assignment-rules");
  const now = new Date(2026, 10, 4, 10, 0);
  const three = reviewFixBy(null, now);
  assert.deepEqual([three.getDate(), three.getHours(), three.getMinutes()], [7, 23, 59]);
  assert.equal(reviewFixBy(new Date(2026, 10, 2).toISOString(), now).getDate(), 7, "a past due date doesn't pull it back");
  assert.equal(reviewFixBy(new Date(2026, 10, 12, 17, 0).toISOString(), now).getTime(), new Date(2026, 10, 12, 17, 0).getTime(), "a later due date wins");
  const rows = [{ who: "Zara", submittedBy: null, title: "Lab 1", submittedAt: "2026-11-04T08:00:00Z", late: false }, { who: "Team A", submittedBy: "Asha Nair", title: "Lab 1", submittedAt: "2026-11-04T09:00:00Z", late: true },
    { who: "Kiran", submittedBy: null, title: "Lab 2", submittedAt: "2026-11-04T07:00:00Z", late: false }];
  assert.deepEqual(queueOrder(rows, "oldest", "").map((r) => r.who), ["Kiran", "Zara", "Team A"]);
  assert.deepEqual(queueOrder(rows, "newest", "").map((r) => r.who), ["Team A", "Zara", "Kiran"]);
  assert.deepEqual(queueOrder(rows, "late", "").map((r) => r.who), ["Team A", "Kiran", "Zara"]);
  assert.deepEqual(queueOrder(rows, "oldest", "asha").map((r) => r.who), ["Team A"], "who handed in for a team matches");
});

test("3.9, 3.10: the board's own buttons step aside while the queue shows; Undo says the decision came back", () => {
  const tab = source("src/components/workspaces/v2/TasksTab.tsx");
  assert.match(tab, /const reviewing = Boolean\(orgId && scope === "review" && canManageWorkflow\);/);
  assert.match(tab, /\{reviewing \? null : <>/);
  assert.match(source("src/lib/feedback/index.ts"), /export function deferredFeedback\(message: string, undo: \(\) => void, commit: \(\) => void, restored = 'Message restored'\)/);
  assert.match(source("src/components/organizations/ReviewQueueParts.tsx"), /'Decision taken back'\)/);
});

test("5.1, 5.2, 5.5: one word per state, the panel header uses the Hand in card's chip, and the card's parts are headings", async () => {
  const { ASSIGNMENT_STATE_LABELS } = await import("../../src/lib/copy/terms");
  const { handInChip } = await import("../../src/lib/organizations/assignment-rules");
  assert.equal(ASSIGNMENT_STATE_LABELS.submitted, handInChip("submitted", false).label, "In review on every surface");
  assert.equal(ASSIGNMENT_STATE_LABELS.done, handInChip("done", false).label, "Done when no review; Approved when reviewed");
  assert.equal(handInChip("done", true).label, "Approved");
  assert.match(source("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /<HandInChip copyId=\{resource\.task\.id\}/);
  assert.match(source("src/components/organizations/HandInSection.tsx"), /<h4 className=\{label\}>Steps · /);
  assert.doesNotMatch(source("src/components/organizations/AssignmentsPanel.tsx"), /submitted by \$\{current/);
});

test("3.9: a decision waiting out its 10 seconds keeps the tab from closing without asking", () => {
  const parts = source("src/components/organizations/ReviewQueueParts.tsx");
  assert.match(parts, /window\.addEventListener\('beforeunload', stay\)/);
  assert.match(parts, /deferredFeedback\(message, \(\) => \{ done\(\); onUndo\(\) \}, \(\) => \{ done\(\);/);
});
