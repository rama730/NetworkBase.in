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
    api.state.home = { tasks: { open: 1, byStatus: { todo: 1, in_progress: 0, blocked: 0, in_review: 0 }, overdue: 0, dueThisWeek: 1, workspaces: [{ id: WORKSPACE_ID, title: "Design Lab", open: 1, overdue: 0, dueThisWeek: 1 }] }, unread: 1, reviews: [], assignments: [] };
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

// The M9 walkthrough (E9 #1): the branch journey on a folder that pulled only its own file, as walked on CLI 2.6.1,
// repeated here on every release: git branch → push → merge request → merge → back on main → My reviews.
describe("journeys (M9 walkthrough: branches)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  /** @param {string[]} args */
  const nb = (args) => runCli(args, { api: api.url, cwd, home });
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).branchesOn = true;
    for (let i = 0; i < 40; i++) api.state.files.set(`/lib/m${i}.ts`, { path: `/lib/m${i}.ts`, nodeId: `n${i}`, version: 1, content: Buffer.from(`m${i}\n`), updatedAt: new Date().toISOString(), history: [] });
    cwd = await tempDir("nb-walk-");
    home = await tempDir("nb-walk-home-");
    await nb(["init", "design-lab"]);
  });
  after(() => api.close());

  it("git branch → push saves there (no other files fetched) → merge request → merge → the folder is on main again", async () => {
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".git", "HEAD"), "ref: refs/heads/walk\n");
    fs.writeFileSync(path.join(cwd, "walk.md"), "on the branch\n");
    const pushed = await nb(["push", "walk.md", "--yes", "-m", "Branch edit"]);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout + pushed.stderr, /switching this folder to walk/);
    assert.equal(api.requests.filter((r) => r.path.endsWith("/raw")).length, 0, "the 40 files this folder never pulled stay on the server");
    const made = await nb(["merge-request", "create", "--title", "Walk"]);
    assert.equal(made.code, 0, made.stderr);
    const merged = await nb(["merge-request", "merge", "--yes"]);
    assert.equal(merged.code, 0, merged.stderr);
    assert.match(merged.stdout, /this folder is on main again/);
    const status = await nb(["status"]);
    assert.equal(status.code, 0, status.stderr);
    const reviews = await runCli(["merge-request", "list", "--review-requested", "--all"], { api: api.url, home });
    assert.equal(reviews.code, 0, reviews.stderr);
  });
});
