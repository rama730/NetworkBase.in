import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

const A = "cccccccc-3333-4333-8333-333333333333";
const B = "dddddddd-4444-4444-8444-444444444444";

// Report §17.4 / §17.4.1 / A7.3: the rest of the task, subtask, comment, file and workspace commands and tools.
describe("more commands", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-work-");
    home = await tempDir("nb-work-home-");
    await nb(["init", "design-lab"]);
  });
  afterEach(() => api.close());

  it("task edit, assign, report and delete", async () => {
    const t = addTask(api.state, { title: "Logo" });
    assert.equal((await nb(["task", "edit", "1", "--title", "New logo", "--priority", "high", "--due", "2026-12-01"])).code, 0);
    assert.equal(api.state.tasks[0]?.title, "New logo");
    assert.equal(api.state.tasks[0]?.priority, "high");
    assert.equal((await nb(["task", "assign", "1", "@sam"])).code, 0);
    assert.equal(api.state.tasks[0]?.assigneeUsername, "sam");
    assert.equal((await nb(["task", "assign", "1", "@nobody"])).code, 1);
    const report = await nb(["task", "report", "1", "-m", "Half done", "--check", "lint=pass"]);
    assert.equal(report.code, 0, report.stderr);
    assert.match(t.comments.at(-1)?.content ?? "", /\*\*Report\*\* Half done\n\n- ✓ lint/);
    assert.equal((await nb(["task", "delete", "1"])).code, 7, "asks first");
    assert.equal((await nb(["task", "delete", "1", "--yes"])).code, 0);
    assert.equal(api.state.tasks.length, 0);
  });

  it("subtask edit, move, delete by number", async () => {
    addTask(api.state, { title: "T", subtasks: [{ id: A, title: "One", completed: false, updatedAt: "x" }, { id: B, title: "Two", completed: false, updatedAt: "x" }] });
    assert.equal((await nb(["subtask", "edit", "1", "First", "--task", "1"])).code, 0);
    assert.equal(api.state.tasks[0]?.subtasks[0]?.title, "First");
    assert.equal((await nb(["subtask", "move", "2", "1", "--task", "1"])).code, 0);
    assert.deepEqual(api.state.tasks[0]?.subtasks.map((s) => s.id), [B, A]);
    assert.equal((await nb(["subtask", "delete", "1", "--task", "1", "--yes"])).code, 0);
    assert.deepEqual(api.state.tasks[0]?.subtasks.map((s) => s.id), [A]);
  });

  it("line comments: add on lines, list, resolve", async () => {
    putFile(api.state, "/src/app.ts", Buffer.from("one\ntwo\nthree\n"));
    const added = await nb(["comment", "add", "-m", "Rename this", "--file", "src/app.ts:2-3"]);
    assert.equal(added.code, 0, added.stderr);
    assert.deepEqual([api.state.fileComments[0].metadata.anchor.startLine, api.state.fileComments[0].metadata.anchor.endLine], [2, 3]);
    const list = await nb(["comment", "list", "--file", "src/app.ts"]);
    assert.match(list.stdout, /open \/src\/app\.ts:2-3/);
    assert.match(list.stdout, /Test User: Rename this/);
    const thread = api.state.fileComments[0].metadata.threadId.slice(0, 8);
    assert.equal((await nb(["comment", "resolve", thread, "--file", "src/app.ts"])).code, 0);
    assert.equal(api.state.fileComments.at(-1).metadata.resolved, true);
  });

  it("file history shows via, attach/detach, rename and delete ask first", async () => {
    putFile(api.state, "/notes.md", Buffer.from("a"));
    putFile(api.state, "/notes.md", Buffer.from("b"));
    addTask(api.state, { title: "T" });
    assert.match((await nb(["file", "history", "notes.md"])).stdout, /v2 .* @tester via Claude Code/);
    assert.equal((await nb(["file", "attach", "notes.md", "--task", "1", "--as", "reference"])).code, 0);
    assert.equal(api.state.tasks[0]?.files[0]?.role, "reference");
    assert.equal((await nb(["file", "detach", "notes.md", "--task", "1"])).code, 0);
    assert.equal(api.state.tasks[0]?.files.length, 0);
    assert.equal((await nb(["file", "rename", "notes.md", "plan.md", "--yes"])).code, 0);
    assert.ok(api.state.files.has("/plan.md"));
    assert.equal((await nb(["file", "delete", "plan.md"])).code, 7);
  });

  it("workspace view, activity, sprints in the workspace's words, update post", async () => {
    addTask(api.state, { title: "Logo" });
    assert.match((await nb(["workspace", "view"])).stdout, /tasks +1 open/);
    assert.match((await nb(["activity", "--since", "1d"])).stdout, /@tester via Claude Code +status changed +#1 Logo/);
    assert.match((await nb(["sprint", "list"])).stdout, /Unit +Status/);
    assert.match((await nb(["sprint", "view", "1"])).stdout, /#1 Logo/);
    assert.equal((await nb(["update", "post", "-m", "Shipped", "--yes"])).code, 0);
    assert.deepEqual(api.state.updates, ["Shipped"]);
  });

  it("MCP: the new tools are listed and run", async () => {
    addTask(api.state, { title: "Logo" });
    const mcp = await startMcp({ api: api.url, cwd, home });
    try {
      const names = (await mcp.request("tools/list")).result.tools.map((/** @type {any} */ t) => t.name);
      for (const n of ["networkbase_workspace_view", "networkbase_activity", "networkbase_task_edit", "networkbase_task_report", "networkbase_comment_list", "networkbase_file_history", "networkbase_file_attach", "networkbase_file_move", "networkbase_sprint_list", "networkbase_task_assign"]) assert.ok(names.includes(n), n);
      const edit = (await mcp.request("tools/call", { name: "networkbase_task_edit", arguments: { task: "1", priority: "urgent" } })).result;
      assert.equal(edit.structuredContent.status, "ok", edit.content[0].text);
      assert.equal(api.state.tasks[0]?.priority, "urgent");
      const move = (await mcp.request("tools/call", { name: "networkbase_file_move", arguments: { path: "/x.md", action: "delete" } })).result;
      assert.equal(move.structuredContent.status, "needs_confirmation");
    } finally {
      await mcp.close();
    }
  });
});
