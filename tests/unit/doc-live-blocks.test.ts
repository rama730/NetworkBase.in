import assert from "node:assert/strict";
import { test } from "node:test";

import { canAddRows, canTickRow, liveBlockLine, newBlockKey, orderRows, parseLiveBlocks, visibleRows, MAX_BLOCK_ROWS } from "../../src/lib/workspaces/doc-live-blocks";

// Report 38.3 F2 part 7: every case listed there.
test("parseLiveBlocks: keys and labels, a block without a key, unknown kinds, code fences ignored", () => {
  const md = [
    "## Action items",
    '{% project.task_rows key="k7f3" label="Action items" %}',
    '{% project.task_rows key="a1b2" label="Checklist" %}',
    "{% project.task_rows %}",
    '{% project.mystery key="zzzz" %}',
    "```",
    '{% project.task_rows key="code" label="In code" %}',
    "```",
  ].join("\n");
  assert.deepEqual(parseLiveBlocks(md).map((b) => [b.kind, b.key, b.label]), [
    ["task_rows", "k7f3", "Action items"], ["task_rows", "a1b2", "Checklist"], ["task_rows", null, "Action items"], ["unknown", "zzzz", null],
  ]);
});

test("newBlockKey: 4–6 lowercase characters, never one in use (1,000 draws against 50)", () => {
  const existing = Array.from({ length: 50 }, (_, i) => `k${i.toString(36).padStart(3, "0")}`);
  for (let i = 0; i < 1000; i++) {
    const key = newBlockKey(existing);
    assert.match(key, /^[a-z0-9]{4,6}$/);
    assert.ok(!existing.includes(key));
  }
  assert.equal(liveBlockLine("task_rows", "k7f3", "Action items"), '{% project.task_rows key="k7f3" label="Action items" %}');
});

test("canAddRows follows the document, canTickRow the task (B9)", () => {
  assert.equal(canAddRows({ canEdit: false }), false, "a leaders-only document and a member");
  assert.equal(canTickRow({ canEditTask: true }), true, "but they tick their own task");
  assert.equal(canAddRows({ canEdit: false }) || canTickRow({ canEditTask: false }), false, "viewer: neither");
  assert.equal(canAddRows({ canEdit: true }), true);
  assert.equal(MAX_BLOCK_ROWS, 200);
});

test("orderRows: open first by position, completed stay in place 7 days, then fold", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const rows = [
    { id: "a", position: 1, status: "done", completedAt: day(8) },
    { id: "b", position: 2, status: "todo", completedAt: null },
    { id: "c", position: 3, status: "done", completedAt: day(6) },
    { id: "d", position: 0, status: "in_progress", completedAt: null },
  ];
  const { shown, folded } = orderRows(rows, now);
  assert.deepEqual(shown.map((r) => r.id), ["d", "b", "c"]);
  assert.deepEqual(folded.map((r) => r.id), ["a"]);
});

test("visibleRows: a public reader with Tasks private sees none and the count", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(visibleRows(rows, { canSeeTasks: false }), { rows: [], hidden: 2 });
  assert.deepEqual(visibleRows(rows, { canSeeTasks: true }), { rows, hidden: 0 });
});
