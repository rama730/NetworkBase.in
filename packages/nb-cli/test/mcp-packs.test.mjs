import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D14 (M4c): a core set is always loaded; the rest come in packs, so a session starts under 4,000 tokens.
describe("tool packs (D14)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  before(async () => {
    api = await startFakeServer();
    const cwd = await tempDir("nb-packs-");
    const home = await tempDir("nb-packs-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    mcp = await startMcp({ api: api.url, cwd, home });
  });
  after(async () => { await mcp.close(); await api.close(); });

  it("starts under 4,000 tokens (characters ÷ 4) with the core set and the pack loader", async () => {
    const init = await mcp.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.capabilities.tools.listChanged, true);
    const { result } = await mcp.request("tools/list");
    const tokens = Math.ceil(JSON.stringify(result.tools).length / 4);
    assert.ok(tokens < 4000, `tools/list is ${tokens} tokens`);
    const names = result.tools.map((/** @type {any} */ t) => t.name);
    for (const core of ["networkbase_task_list", "networkbase_task_context", "networkbase_task_done", "networkbase_file_push", "networkbase_undo", "networkbase_more_tools"]) assert.ok(names.includes(core), core);
    assert.ok(!names.includes("networkbase_file_history"), "pack tools wait until asked for");
  });

  it("loads a pack for the session, tells the client the list changed, and names what it added", async () => {
    const before = mcp.lines.length;
    const r = await mcp.call("networkbase_more_tools", { pack: "files" });
    assert.equal(r.structuredContent.status, "ok", r.content[0].text);
    assert.match(r.content[0].text, /networkbase_file_history/);
    assert.ok(mcp.lines.slice(before).some((l) => l.includes("notifications/tools/list_changed")));
    const names = (await mcp.request("tools/list")).result.tools.map((/** @type {any} */ t) => t.name);
    assert.ok(names.includes("networkbase_file_history"));
    const list = await mcp.call("networkbase_more_tools", {});
    assert.match(list.content[0].text, /files .*loaded/);
  });

  it("networkbase_run calls a pack tool by name on any client, and passes its yes along", async () => {
    const r = await mcp.call("networkbase_run", { tool: "networkbase_sprint_list", args: {} });
    assert.equal(r.structuredContent.status, "ok", r.content[0].text);
    const loaded = await mcp.call("networkbase_more_tools", { pack: "files" });
    assert.match(loaded.content[0].text, /networkbase_run \{ tool, args \}[\s\S]*- networkbase_trash\(query\?, workspace\?\)/);
    const held = await mcp.call("networkbase_run", { tool: "networkbase_file_move", args: { path: "/x.md", action: "delete" } });
    assert.equal(held.structuredContent.status, "needs_confirmation");
    assert.equal((await mcp.call("networkbase_run", { tool: "networkbase_nope" })).isError, true);
  });

  it("a pack tool runs even before its pack is loaded; an unknown tool names the packs", async () => {
    addTask(api.state, { title: "Logo" });
    const sprints = await mcp.call("networkbase_sprint_list");
    assert.notEqual(sprints.isError, true, sprints.content[0].text);
    const unknown = await mcp.call("networkbase_nope");
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /networkbase_more_tools/);
  });
});
