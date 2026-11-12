import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D5, D17 (M4c): while an agent works on a task the task shows it; a second agent is told about the first.
describe("presence per agent (D5, D17)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  before(async () => {
    api = await startFakeServer();
    const cwd = await tempDir("nb-presence-");
    const home = await tempDir("nb-presence-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    mcp = await startMcp({ api: api.url, cwd, home });
    await mcp.request("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "codex-mcp-client", version: "1" } });
  });
  after(async () => { await mcp.close(); await api.close(); });

  it("working on a task says so, with the agent's name and session; another agent there is mentioned", async () => {
    const t = addTask(api.state, { title: "Parse the logs", status: "in_progress" });
    api.state.presenceOthers = ["Claude Code"];
    const r = await mcp.call("networkbase_task_context", { task: String(t.taskNumber) });
    assert.match(r.content[0].text, /Claude Code is also working on #1/);
    const ping = api.requests.find((q) => q.method === "POST" && q.path === `/api/v1/tasks/${t.id}/presence`);
    assert.equal(ping?.body.agentName, "Codex");
    assert.ok(ping?.body.sessionId);
    const pings = () => api.requests.filter((q) => q.path === `/api/v1/tasks/${t.id}/presence`).length;
    const n = pings();
    await mcp.call("networkbase_subtask_list", { task: String(t.taskNumber) });
    assert.equal(pings(), n, "at most one heartbeat a minute per task");
  });
});
