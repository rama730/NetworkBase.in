import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D3 (M4c): several big steps become one preview and one yes, which covers exactly those steps.
describe("one plan, one yes (D3)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-plan-");
    home = await tempDir("nb-plan-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());

  it("one preview lists every step; one yes runs them in order", async () => {
    const mcp = await startMcp({ api: api.url, cwd, home });
    try {
      const a = addTask(api.state, { title: "Ship it", status: "in_progress" });
      const b = addTask(api.state, { title: "Tell Sam" });
      const plan = { summary: "Finish #1 and tell Sam", steps: [
        { tool: "networkbase_task_done", args: { task: String(a.taskNumber), summary: "Done and tested" } },
        { tool: "networkbase_comment_add", args: { task: String(b.taskNumber), text: "@sam #1 is done" } },
      ] };
      const first = await mcp.call("networkbase_plan", plan);
      assert.equal(first.structuredContent.status, "needs_confirmation", first.content[0].text);
      assert.match(first.structuredContent.summary, /^Finish #1 and tell Sam\n1\. Mark task 1 done[^\n]*\n2\. Comment on task 2 that tells @sam/);
      assert.equal(api.state.tasks.find((t) => t.id === a.id)?.status, "in_progress", "nothing yet");
      const run = await mcp.call("networkbase_plan", { ...plan, confirmToken: first.structuredContent.confirmToken });
      assert.equal(run.structuredContent.status, "ok", run.content[0].text);
      assert.equal(api.state.tasks.find((t) => t.id === a.id)?.status, "done");
      assert.match(api.state.tasks.find((t) => t.id === b.id)?.comments.at(-1)?.content ?? "", /is done/);
      assert.deepEqual(run.structuredContent.data.done.length, 2);
      const changed = await mcp.call("networkbase_plan", { ...plan, steps: plan.steps.slice(0, 1), confirmToken: first.structuredContent.confirmToken });
      assert.equal(changed.isError, true, "the yes covers exactly those steps");
    } finally { await mcp.close(); }
  });

  it("with an agent sign-in the server's own hold is answered by the same yes", async () => {
    api.state.agentAccess = { agentName: "Claude Code", preset: "full", sentence: "Claude Code can work in Design Lab for 30 days.", workspaceId: null, workspaceTitle: "Design Lab", allWorkspaces: false, expiresAt: "2026-12-11T00:00:00.000Z" };
    const mcp = await startMcp({ api: api.url, cwd, home, token: "nb_agt_0123456789abcdef0123" });
    try {
      const t = addTask(api.state, { title: "Agent finish", status: "in_progress" });
      const plan = { summary: "Finish it", steps: [{ tool: "networkbase_task_done", args: { task: String(t.taskNumber), summary: "ok" } }] };
      const first = await mcp.call("networkbase_plan", plan);
      assert.equal(first.structuredContent.status, "needs_confirmation");
      const run = await mcp.call("networkbase_plan", { ...plan, confirmToken: first.structuredContent.confirmToken });
      assert.equal(run.structuredContent.status, "ok", run.content[0].text);
      assert.equal(api.state.tasks.find((x) => x.id === t.id)?.status, "done");
    } finally { await mcp.close(); delete api.state.agentAccess; }
  });

  it("a step that fails stops the plan with what's done and not", async () => {
    const mcp = await startMcp({ api: api.url, cwd, home });
    try {
      const t = addTask(api.state, { title: "First" });
      const plan = { summary: "Two comments", steps: [
        { tool: "networkbase_comment_add", args: { task: String(t.taskNumber), text: "one" } },
        { tool: "networkbase_comment_add", args: { task: "99", text: "two" } },
        { tool: "networkbase_comment_add", args: { task: String(t.taskNumber), text: "three" } },
      ] };
      const first = await mcp.call("networkbase_plan", plan);
      const run = await mcp.call("networkbase_plan", { ...plan, confirmToken: first.structuredContent.confirmToken });
      assert.equal(run.isError, true);
      const { details } = run.structuredContent.error;
      assert.equal(details.done.length, 1);
      assert.equal(details.notDone.length, 2);
      assert.ok(details.retryKey);
      assert.ok(!api.state.tasks.find((x) => x.id === t.id)?.comments.some((c) => c.content === "three"), "nothing after the failure");
    } finally { await mcp.close(); }
  });
});
