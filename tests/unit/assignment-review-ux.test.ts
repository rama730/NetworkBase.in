import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
