import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D16 (M4c, 0089): the agent saves where it stopped; the next session reads it with the task.
describe("agent notes (D16)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-notes-");
    home = await tempDir("nb-notes-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());

  it("networkbase_task_note saves the note with the agent's name; the next session's task brief starts from it", async () => {
    const t = addTask(api.state, { title: "Parse the logs", status: "in_progress" });
    const first = await startMcp({ api: api.url, cwd, home });
    try {
      await first.request("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1" } });
      const saved = await first.call("networkbase_task_note", { task: String(t.taskNumber), note: "parsed 3 of 5 files; next: tests" });
      assert.equal(saved.structuredContent.status, "ok", saved.content[0].text);
    } finally { await first.close(); }
    const posted = api.requests.find((q) => q.method === "POST" && q.path === `/api/v1/tasks/${t.id}/agent-notes`);
    assert.equal(posted?.body.agentName, "Claude Code");
    assert.ok(posted?.body.sessionId);
    const next = await startMcp({ api: api.url, cwd, home });
    try {
      const brief = await next.call("networkbase_task_context", { task: String(t.taskNumber) });
      assert.deepEqual(brief.structuredContent.data.untrusted.agentNotes.map((/** @type {any} */ n) => [n.by, n.note]), [["Claude Code", "parsed 3 of 5 files; next: tests"]]);
      const md = await runCli(["task", "view", String(t.taskNumber), "--context"], { api: api.url, cwd, home });
      assert.match(md.stdout, /Where the last session stopped[^\n]*\n<untrusted source="networkbase agent notes">\n- Claude Code[^:]*: parsed 3 of 5 files; next: tests/);
    } finally { await next.close(); }
  });

  it("nb task note lists and deletes", async () => {
    const t = addTask(api.state, { title: "Long job" });
    await runCli(["task", "note", String(t.taskNumber), "step one done"], { api: api.url, cwd, home });
    const list = await runCli(["task", "note", String(t.taskNumber), "--list"], { api: api.url, cwd, home });
    assert.match(list.stdout, /step one done/);
    const id = api.state.agentNotes.find((/** @type {any} */ n) => n.taskId === t.id)?.id;
    const gone = await runCli(["task", "note", String(t.taskNumber), "--delete", id], { api: api.url, cwd, home });
    assert.equal(gone.code, 0, gone.stderr);
    assert.equal(api.state.agentNotes.filter((/** @type {any} */ n) => n.taskId === t.id).length, 0);
  });
});
