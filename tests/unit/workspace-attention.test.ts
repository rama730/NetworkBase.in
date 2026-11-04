import assert from "node:assert/strict";
import { test } from "node:test";

import { attentionItems, reasonCounts, workspacesSummary } from "../../src/lib/organizations/workspace-attention";

// Workspaces report §4 F1, G7–G9: each reason gets its own label and fix; counts come from the same rows.
const row = (over: Partial<Parameters<typeof attentionItems>[0]> = {}) => ({ reasons: [], needsLead: false, status: "active", mine: false, groupCopy: null, ...over });

test("each reason becomes a label with its own fix", () => {
  const items = attentionItems(row({ reasons: ["3 overdue", "quiet 7 days", "group assignment missing", "lead left the organization"], groupCopy: { title: "ALM-1" } }));
  assert.deepEqual(items.map((i) => [i.kind, i.label, i.action, i.actionLabel]), [
    ["overdue", "3 overdue", "board", "Open board"],
    ["quiet", "Quiet 7 days", "remind", "Remind workspace lead"],
    ["group", "ALM-1 not handed in", "assignment", "Open assignment"],
    ["lead", "Needs a new workspace lead", "assign", "Assign"],
  ]);
  assert.deepEqual(attentionItems(row({ reasons: ["group assignment returned"], groupCopy: { title: "ALM-1" } })).map((i) => [i.label, i.action]), [["ALM-1 returned", "review"]]);
});

test("a lead handover counts once, and archived workspaces need nothing", () => {
  assert.deepEqual(attentionItems(row({ needsLead: true })).map((i) => i.kind), ["lead"]);
  assert.deepEqual(attentionItems(row({ needsLead: true, reasons: ["lead left the organization"] })).map((i) => i.kind), ["lead"]);
  assert.deepEqual(attentionItems(row({ status: "archived", reasons: ["3 overdue"] })), []);
});

test("the summary and reason chips count from the rows", () => {
  const rows = [row({ reasons: ["quiet 7 days"], mine: true }), row({ needsLead: true }), row({}), row({ status: "archived", reasons: ["quiet 7 days"] })];
  assert.deepEqual(workspacesSummary(rows, true), { total: 3, attention: 2, quiet: 1, archived: 1, mine: 1 });
  assert.deepEqual(workspacesSummary(rows, false), { total: 3, attention: 0, quiet: 0, archived: 0, mine: 1 });
  assert.deepEqual(reasonCounts(rows), { overdue: 0, quiet: 1, lead: 1, group: 0 });
});
