import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Report §26.5: the plugin's skill names only tools the MCP server has, and its server entry matches `nb agent setup`.
it("the Claude Code plugin's skill names only real MCP tools", async () => {
  const { TOOLS } = await import("../../packages/nb-cli/lib/mcp/tools.mjs");
  const names = new Set((TOOLS as Array<{ name: string }>).map((t) => t.name));
  const skill = fs.readFileSync("integrations/claude-code-plugin/plugins/networkbase/skills/networkbase/SKILL.md", "utf8");
  const used = [...new Set(skill.match(/networkbase_[a-z_]+/g) ?? [])];
  assert.ok(used.length > 5);
  assert.deepEqual(used.filter((n) => !names.has(n)), []);
  const mcp = JSON.parse(fs.readFileSync("integrations/claude-code-plugin/plugins/networkbase/.mcp.json", "utf8"));
  assert.deepEqual(mcp.mcpServers.networkbase.args, ["-y", "@networkbase/cli@2", "mcp"]);
});
