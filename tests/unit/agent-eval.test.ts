import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import { TOOLS } from "../../packages/nb-cli/lib/mcp/tools.mjs";
import { toolCalls } from "../../scripts/agents/eval.mts";

// Report D22 (M4c): the agent test's requests name real tools, once each, with known personas; and the scorer reads
// each agent's output.
test("about 150 requests, unique ids, real tool names, known personas", () => {
  const requests = parse(fs.readFileSync("tests/agents/requests.yaml", "utf8")) as Array<{ id: string; persona?: string; expect?: string[]; forbid?: string[] }>;
  assert.ok(requests.length >= 150, `${requests.length} requests`);
  assert.equal(new Set(requests.map((r) => r.id)).size, requests.length, "ids are unique");
  const names = new Set((TOOLS as Array<{ name: string }>).map((t) => t.name));
  const unknown = requests.flatMap((r) => [...(r.expect ?? []), ...(r.forbid ?? [])].filter((t) => !names.has(t)).map((t) => `${r.id}: ${t}`));
  assert.deepEqual(unknown, [], "a renamed tool must rename its requests");
  for (const r of requests) assert.ok(["normal", "heavy", "student", "teacher", "lead"].includes(r.persona ?? "normal"), r.id);
  for (const p of ["student", "teacher", "lead", "heavy"]) assert.ok(requests.some((r) => r.persona === p), p);
});

test("tool calls from Claude Code, Codex and a generic JSON-lines agent; a held call isn't counted as run", () => {
  const claude = [
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "mcp__networkbase__networkbase_task_done" }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_result", content: "needs_confirmation: Finish #4" }] } }),
  ].join("\n");
  assert.deepEqual(toolCalls(claude), [{ name: "networkbase_task_done", held: true }]);
  const codex = JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "networkbase_task_list", result: { ok: true } } });
  assert.deepEqual(toolCalls(codex), [{ name: "networkbase_task_list", held: false }]);
  const generic = [JSON.stringify({ type: "tool_call", toolName: "networkbase/networkbase_comment_add" }), JSON.stringify({ type: "tool_result", text: "needs_confirmation" })].join("\n");
  assert.deepEqual(toolCalls(generic), [{ name: "networkbase_comment_add", held: true }]);
});
