import assert from "node:assert/strict";
import { test } from "node:test";

import { llmsText, toolReference } from "../../src/lib/agents/tool-reference";
import { TOOLS } from "../../packages/nb-cli/lib/mcp/tools.mjs";

// Report D20 (M4c): the reference is generated from the MCP tool definitions, so it lists every tool exactly once.
test("every tool appears once, in its pack, with its yes rule", () => {
  const listed = toolReference().flatMap((g) => g.tools.map((t) => t.name));
  assert.deepEqual([...listed].sort(), (TOOLS as Array<{ name: string }>).map((t) => t.name).sort());
  const core = toolReference().find((g) => g.pack === "core")!;
  assert.ok(core.tools.some((t) => t.name === "networkbase_task_done" && t.tier === "yes"));
  const classes = toolReference().find((g) => g.pack === "classes")!;
  assert.ok(classes.tools.some((t) => t.name === "networkbase_assignment_hand_in"));
});

test("llms.txt names the tools, the packs, the rules and the docs", () => {
  const text = llmsText();
  assert.match(text, /^# NetworkBase\n/);
  for (const name of ["networkbase_task_list", "networkbase_plan", "networkbase_review_approve", "networkbase_more_tools"]) assert.ok(text.includes(`- ${name}:`), name);
  assert.match(text, /### classes \(assignments, hand-ins and reviews\)/);
  assert.match(text, /needs_confirmation/);
  assert.match(text, /\/docs\/agents\/tools/);
  // 0.8 #12: each milestone's docs are linked (M5 change sets, M8 history, branches and merge requests).
  assert.match(text, /\/docs\/files\/changes/);
  assert.match(text, /\[History, branches and merge requests\]\([^)]*\/docs\/files\/branches\)/);
  assert.ok(text.length < 20_000, `${text.length} characters`);
});

// Search + AI findability (Task 7): llms.txt tells AI readers where public pages and their markdown copies live.
test("llms.txt lists the public page addresses and the .md copies", () => {
  const text = llmsText();
  assert.match(text, /\n## Public pages\n/);
  for (const line of [
    "- Workspaces: https://networkbase.in/workspaces/<slug>",
    "- Organizations: https://networkbase.in/org/<handle>",
    "- People: https://networkbase.in/u/<username>",
    "- Add .md to any of these for a markdown copy.",
    "- Sitemap: https://networkbase.in/sitemap.xml",
  ]) assert.ok(text.includes(line), line);
  assert.ok(text.indexOf("## Public pages") < text.indexOf("## Working with NetworkBase"));
});
