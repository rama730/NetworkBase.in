import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

describe("nb agent setup (report A7.8, A7.9)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("Claude Code: asks first, then writes .mcp.json and a CLAUDE.md section; remove undoes it", async () => {
    const cwd = await tempDir("nb-agent-");
    const home = await tempDir("nb-agent-home-");
    const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
    await nb(["init", "design-lab"]);
    fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# My project\n");
    fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    assert.equal((await nb(["agent", "setup", "claude"])).code, 7, "needs a yes");
    assert.equal((await nb(["agent", "setup", "claude", "--yes"])).code, 0);
    const mcp = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers.networkbase, { command: "npx", args: ["-y", "@networkbase/cli@2", "mcp"] });
    assert.ok(mcp.mcpServers.other, "keeps other servers");
    assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /# My project\n\n<!-- networkbase:start -->\n## NetworkBase\nThis folder is linked to the NetworkBase workspace "Design Lab"/);
    assert.match((await nb(["agent", "setup", "claude", "--yes"])).stdout, /already set up/);
    assert.match((await nb(["agent", "status"])).stdout, /Claude Code\s+connected\s+added/);
    assert.equal((await nb(["agent", "remove", "claude", "--yes"])).code, 0);
    assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), "# My project\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")), { mcpServers: { other: { command: "x" } } });
  });

  it("Codex: adds a block to config.toml and removes only that block", async () => {
    const cwd = await tempDir("nb-agent-");
    const home = await tempDir("nb-agent-home-");
    const codexHome = await tempDir("nb-codex-");
    fs.writeFileSync(path.join(codexHome, "config.toml"), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "y"\n');
    const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home, env: { CODEX_HOME: codexHome } });
    await nb(["init", "design-lab"]);
    assert.equal((await nb(["agent", "setup", "codex", "--yes"])).code, 0);
    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.match(toml, /\[mcp_servers\.networkbase\]\ncommand = "npx"\nargs = \["-y", "@networkbase\/cli@2", "mcp"\]/);
    assert.ok(fs.existsSync(path.join(cwd, "AGENTS.md")));
    await nb(["agent", "remove", "codex", "--yes"]);
    assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "y"\n');
    assert.ok(!fs.existsSync(path.join(cwd, "AGENTS.md")), "the file it created is gone");
  });
});
