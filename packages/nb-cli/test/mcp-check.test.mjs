import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D9, D10, D19 (M4c): every write says what it did with its undo; the session has a "What I did" list; a tool
// that stops halfway says what's done and not, and a retry with its retryKey does nothing twice; answers stay short.
describe("easy to check and recover (D9, D10, D19)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  before(async () => {
    api = await startFakeServer();
    const cwd = await tempDir("nb-check-");
    const home = await tempDir("nb-check-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    mcp = await startMcp({ api: api.url, cwd, home });
  });
  after(async () => { await mcp.close(); await api.close(); });

  it("a write answers with one sentence and its undo; What I did lists the session's changes", async () => {
    const t = addTask(api.state, { title: "Logo" });
    const r = await mcp.call("networkbase_task_edit", { task: String(t.taskNumber), priority: "high" });
    assert.equal(r.structuredContent.status, "ok", r.content[0].text);
    assert.match(r.content[0].text, /\nundo: networkbase_undo \{ token: "[0-9a-f-]{36}" \}$/);
    assert.ok(r.structuredContent.undo?.length);
    const did = await mcp.call("networkbase_what_i_did");
    assert.match(did.content[0].text, /^What I did this session:\n1\. .*#1.*· undo: [0-9a-f-]{36}/m);
  });

  it("a tool that stops halfway says what's done and not; retrying with retryKey repeats nothing", async () => {
    const t = addTask(api.state, { title: "Hero" });
    api.setFault(`/api/v1/tasks/${t.id}/meta`, "409-second");
    const first = await mcp.call("networkbase_task_tags", { task: String(t.taskNumber), addLabels: ["bug"], watch: true });
    assert.equal(first.isError, true);
    const { details } = first.structuredContent.error;
    assert.equal(details.done.length, 1, JSON.stringify(details));
    assert.match(details.notDone, /task watch/);
    assert.equal(details.safeToRetry, true);
    assert.ok(details.retryKey);
    const keys = () => api.requests.filter((q) => q.path === `/api/v1/tasks/${t.id}/meta` && q.method === "PATCH").map((q) => q.headers["idempotency-key"]);
    const before = keys();
    const again = await mcp.call("networkbase_task_tags", { task: String(t.taskNumber), addLabels: ["bug"], watch: true, retryKey: details.retryKey });
    assert.equal(again.structuredContent.status, "ok", again.content[0].text);
    assert.equal(keys().slice(before.length)[0], before[0], "the labels step is sent with the same key, so the server replays it");
  });

  it("list answers carry only the fields an agent needs (D9)", async () => {
    for (let i = 0; i < 20; i++) addTask(api.state, { title: `Task ${i}`, description: "x".repeat(400) });
    const r = await mcp.call("networkbase_task_list", { all: true });
    const one = r.structuredContent.data.tasks[0];
    assert.deepEqual(Object.keys(one).sort(), ["assignee", "dueDate", "labels", "number", "status", "title"]);
  });
});
