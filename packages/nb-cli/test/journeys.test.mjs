import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C14b journeys (M4d): a normal user's day, a heavy user's day and working offline, one command after another
// as a person would, in one linked folder.
describe("journeys (C14b)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  /** @param {string[]} args */
  const nb = (args) => runCli(args, { api: api.url, cwd, home });
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-journey-");
    home = await tempDir("nb-journey-home-");
    await nb(["init", "design-lab"]);
  });
  after(() => api.close());

  it("a normal user's day: nb, nb next, start by words, edit, push, done, reply from the inbox", async () => {
    addTask(api.state, { title: "Fix the login bug", status: "todo", dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    api.state.home = { tasks: { open: 1, byStatus: { todo: 1, in_progress: 0, blocked: 0, in_review: 0 }, overdue: 0, dueThisWeek: 1, workspaces: [] }, unread: 1, reviews: [], assignments: [] };
    api.state.inbox.push({ id: "n1", title: "Sam commented on #1", body: "any update?", createdAt: new Date().toISOString(), readAt: null, entityRefs: { taskId: api.state.tasks[0].id, projectId: WORKSPACE_ID } });
    const home1 = await nb([]);
    assert.equal(home1.code, 0, home1.stderr);
    assert.match(home1.stdout, /1 due this week/);
    assert.match(home1.stdout, /1 unread/);
    assert.match((await nb(["next"])).stdout, /#1 Fix the login bug .*due soon/);
    const started = await nb(["task", "start", "login bug"]);
    assert.equal(started.code, 0, started.stderr);
    fs.writeFileSync(path.join(cwd, "login.ts"), "export const fixed = true;\n");
    const pushed = await nb(["push", "login.ts"]);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout + pushed.stderr, /#1/, "linked to the started task");
    const done = await nb(["done", "-m", "fixed the redirect", "--yes"]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(api.state.tasks[0].status, "done");
    const reply = await nb(["inbox", "reply", "1", "fixed"]);
    assert.equal(reply.code, 0, reply.stderr);
  });

  it("a heavy user's day: the prompt, a bulk move, a list pasted as Markdown, undo --list, nb ui --plain", async () => {
    const [a, b] = [addTask(api.state, { title: "Copy", status: "todo" }), addTask(api.state, { title: "Icons", status: "todo" })];
    await nb(["task", "start", String(a.taskNumber)]);
    fs.writeFileSync(path.join(cwd, "copy.md"), "draft\n");
    const prompt = await nb(["prompt"]);
    assert.match(prompt.stdout, new RegExp(`\\[#${a.taskNumber}`));
    const moved = await nb(["task", "move", String(a.taskNumber), String(b.taskNumber), "in_progress"]);
    assert.equal(moved.code, 0, moved.stderr);
    const md = (await nb(["task", "list", "--format", "md"])).stdout;
    assert.match(md, /\| # \| Task \|/);
    assert.doesNotMatch(md, /\| [❯>] /, "no terminal marker in a table pasted into chat");
    assert.equal((await nb(["undo", "--list"])).code, 0);
    const ui = await nb(["ui", "--plain"]);
    assert.equal(ui.code, 0, ui.stderr);
    assert.match(ui.stdout, /design-lab/);
  });

  it("offline: reads say offline, a push queues and replays, and what needs the server says so", async () => {
    fs.writeFileSync(path.join(cwd, "offline.md"), "written on a train\n");
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, "drop");
    const queued = await nb(["push", "offline.md"]);
    assert.equal(queued.code, 8, queued.stderr);
    assert.match((await nb(["status"])).stdout, /offline|queued while offline/);
    api.setFault("/api/v1/chat/conversations", "drop");
    const messages = await nb(["message", "list"]);
    assert.equal(messages.code, 8, "messages need the server");
    api.setFault("/api/v1/chat/conversations", null);
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, null);
    const retried = await nb(["queue", "retry"]);
    assert.equal(retried.code, 0, retried.stderr);
    assert.match(retried.stdout, /Sent 1 queued push/);
  });
});
