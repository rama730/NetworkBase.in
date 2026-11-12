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
    assert.equal((await nb(["agent", "setup", "claude", "--token", "mine"])).code, 7, "needs a yes");
    assert.equal((await nb(["agent", "setup", "claude", "--token", "mine", "--yes"])).code, 0);
    const mcp = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers.networkbase, { command: "npx", args: ["-y", "@networkbase/cli@2", "mcp"] });
    assert.ok(mcp.mcpServers.other, "keeps other servers");
    assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /# My project\n\n<!-- networkbase:start -->\n## NetworkBase\nThis folder is linked to the NetworkBase workspace "Design Lab"/);
    assert.match((await nb(["agent", "setup", "claude", "--token", "mine", "--yes"])).stdout, /already set up/);
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
    assert.equal((await nb(["agent", "setup", "codex", "--token", "mine", "--yes"])).code, 0);
    const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    assert.match(toml, /\[mcp_servers\.networkbase\]\ncommand = "npx"\nargs = \["-y", "@networkbase\/cli@2", "mcp"\]/);
    assert.ok(fs.existsSync(path.join(cwd, "AGENTS.md")));
    await nb(["agent", "remove", "codex", "--yes"]);
    assert.equal(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8"), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "y"\n');
    assert.ok(!fs.existsSync(path.join(cwd, "AGENTS.md")), "the file it created is gone");
  });

  it("with no name, sets up every agent installed here in one go, after one preview (D8)", async () => {
    const cwd = await tempDir("nb-agent-all-");
    const home = await tempDir("nb-agent-all-home-");
    const bin = await tempDir("nb-agent-bin-");
    for (const name of ["claude", "gemini", "copilot"]) { fs.writeFileSync(path.join(bin, name), "#!/bin/sh\n"); fs.chmodSync(path.join(bin, name), 0o755); }
    const nb = (/** @type {string[]} */ args, /** @type {string} */ PATH = bin) => runCli(args, { api: api.url, cwd, home, env: { PATH } });
    await nb(["init", "design-lab"]);
    const ask = await nb(["agent", "setup", "--token", "mine"]);
    assert.equal(ask.code, 7, "one yes for all of them");
    assert.match(ask.stderr + ask.stdout, /Claude Code, Gemini CLI and GitHub Copilot/);
    const r = await nb(["agent", "setup", "--token", "mine", "--yes"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers.networkbase);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, ".gemini", "settings.json"), "utf8")).mcpServers.networkbase);
    assert.match(fs.readFileSync(path.join(cwd, "GEMINI.md"), "utf8"), /## NetworkBase/);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, ".github", "mcp.json"), "utf8")).mcpServers.networkbase);
    assert.match(fs.readFileSync(path.join(cwd, ".github", "copilot-instructions.md"), "utf8"), /## NetworkBase/);
    assert.ok(!fs.existsSync(path.join(cwd, ".cursor")), "only installed agents");
    assert.match(r.stdout, /Claude Code/);
    const none = await nb(["agent", "setup", "--token", "mine", "--yes"], await tempDir("nb-empty-bin-"));
    assert.equal(none.code, 2);
    assert.match(none.stderr, /No supported agent found.*claude\|codex\|cursor\|gemini\|copilot/s);
  });

  it("by default the agent gets its own workspace-bound sign-in, in its own profile", async () => {
    const cwd = await tempDir("nb-agent-");
    const home = await tempDir("nb-agent-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const r = await runCli(["agent", "setup", "claude", "--yes"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.device.lastBody.type, api.state.device.lastBody.agentName], ["agent", "Claude Code"]);
    const mcp = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers.networkbase.args, ["-y", "@networkbase/cli@2", "mcp", "--profile", "agent-claude"]);
    assert.match(fs.readFileSync(path.join(home, ".networkbase", "credentials.json"), "utf8"), /"agent-claude"/);
  });
});
