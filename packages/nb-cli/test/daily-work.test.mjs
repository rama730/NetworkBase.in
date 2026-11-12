import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { dueRange } from "../lib/dates.mjs";

// Report C2 MVP: list filters and sort, nb next, tasks by words, quick capture.
describe("daily work (C2)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c2-");
    home = await tempDir("nb-c2-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("dueRange: today, week and overdue are the person's own day, as instants", () => {
    const now = new Date(2026, 10, 12, 15, 30);
    const today = dueRange("today", now);
    assert.deepEqual([new Date(today.after ?? "").getHours(), new Date(today.before ?? "").getDate()], [0, 13]);
    assert.deepEqual(dueRange("overdue", now), { before: now.toISOString() });
    const week = dueRange("week", now);
    assert.equal(Date.parse(week.before ?? "") - Date.parse(week.after ?? ""), 7 * 86_400_000);
    assert.equal(dueRange("someday", now), null);
  });

  it("task list sends its filters to the server", async () => {
    const r = await nb(["task", "list", "--due", "overdue", "--priority", "high,urgent", "--sort", "due", "--to", "@sam"]);
    assert.equal(r.code, 0, r.stderr);
    const q = api.state.lastListQuery;
    assert.equal(q.get("open"), "1");
    assert.ok(q.get("dueBefore") && !q.get("dueAfter"));
    assert.deepEqual([q.get("priority"), q.get("sort"), q.get("assignee"), q.get("scope")], ["high,urgent", "due", "bbbbbbbb-2222-4222-8222-222222222222", "all"]);
    const bad = await nb(["task", "list", "--due", "someday"]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /today, week, overdue/);
  });

  it("nb next puts overdue first, then due soon, then what's in progress", async () => {
    api.state.tasks.length = 0;
    const day = 86_400_000;
    addTask(api.state, { title: "Later", status: "todo", dueDate: new Date(Date.now() + 20 * day).toISOString() });
    addTask(api.state, { title: "Going", status: "in_progress" });
    addTask(api.state, { title: "Soon", status: "todo", dueDate: new Date(Date.now() + 2 * day).toISOString() });
    addTask(api.state, { title: "Late", status: "todo", dueDate: new Date(Date.now() - day).toISOString() });
    const r = await nb(["next", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const d = JSON.parse(r.stdout).data;
    assert.deepEqual(d.items.map((/** @type {any} */ i) => i.title), ["Late", "Soon", "Going", "Later"]);
    assert.deepEqual(d.items.map((/** @type {any} */ i) => i.why), ["overdue", "due soon", "in progress", "to do"]);
    const text = await nb(["next"]);
    assert.match(text.stdout, /Next: nb task start 4/);
    // Reviews waiting for you and assignments due join in the report's order (C2).
    api.state.home = { tasks: { open: 4, byStatus: { todo: 3, in_progress: 1, blocked: 0, in_review: 0 }, overdue: 1, dueThisWeek: 1, workspaces: [] }, unread: 0,
      reviews: [{ id: "r1", number: 9, title: "Check the logo", workspaceId: "cccccccc-3333-4333-8333-333333333333", workspaceTitle: "Ponytail", workspaceSlug: "ponytail" }],
      assignments: [{ id: "a1", number: 2, title: "Essay", org: "Physics 101", due: new Date(Date.now() + day).toISOString(), state: "not_started", late: false }] };
    const mixed = JSON.parse((await nb(["next", "--json", "--limit", "10"])).stdout).data.items;
    assert.deepEqual(mixed.map((/** @type {any} */ i) => i.why), ["overdue", "due soon", "review waiting", "assignment due", "in progress", "to do"]);
    assert.equal(mixed[2].next, "nb task review 9 approve -w ponytail");
    delete api.state.home;
  });

  it("tasks by words: one match runs, several ask (or return the choices)", async () => {
    api.state.tasks.length = 0;
    addTask(api.state, { title: "Fix the login bug", status: "todo" });
    addTask(api.state, { title: "Login page copy", status: "todo" });
    const one = await nb(["task", "view", "login bug", "--json"]);
    assert.equal(one.code, 0, one.stderr);
    assert.equal(JSON.parse(one.stdout).data.title, "Fix the login bug");
    const two = await nb(["task", "view", "login", "--json"]);
    assert.equal(two.code, 6);
    const q = JSON.parse(two.stderr || two.stdout).error.details.questions[0];
    assert.deepEqual(q.options.map((/** @type {any} */ o) => o.value), ["1", "2"]);
    const none = await nb(["task", "view", "payroll"]);
    assert.match(none.stderr, /No open task matches "payroll"/);
    const typo = await nb(["task", "view", "logn bgu"]);
    assert.match(typo.stderr, /Did you mean #1 Fix the login bug, or #2 Login page copy\?/);
  });

  it("nb task add is quick capture: a title and a due date", async () => {
    const r = await nb(["task", "add", "fix the footer", "--due", "tomorrow"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.lastCreate.title, "fix the footer");
    assert.match(api.state.lastCreate.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.stderr + r.stdout, /short for nb task create/);
  });

  it("bulk: move, assign and edit several tasks in one request each", async () => {
    api.state.tasks.length = 0;
    for (const n of [1, 2, 3]) addTask(api.state, { title: `T${n}`, status: "todo" });
    const moved = await nb(["task", "move", "1", "2", "3", "done"]);
    assert.equal(moved.code, 0, moved.stderr);
    assert.match(moved.stdout, /#1, #2, #3 are done/);
    assert.equal(api.state.lastBulk.taskIds.length, 3);
    assert.deepEqual(api.state.tasks.map((t) => t.status), ["done", "done", "done"]);
    const assigned = await nb(["task", "assign", "1", "2", "--to", "@sam"]);
    assert.equal(assigned.code, 0, assigned.stderr);
    assert.deepEqual(api.state.lastBulk.change, { kind: "assign", assigneeId: "bbbbbbbb-2222-4222-8222-222222222222" });
    const edited = await nb(["task", "edit", "1", "2", "--due", "friday"]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.equal(api.state.lastBulk.change.field, "dueDate");
    assert.match(api.state.lastBulk.change.value, /^\d{4}-\d{2}-\d{2}$/);
    const titled = await nb(["task", "edit", "1", "2", "--title", "Same"]);
    assert.equal(titled.code, 2);
  });

  it("a left-out person is a choice: --answer picks, no terminal returns the members", async () => {
    api.state.tasks.length = 0;
    addTask(api.state, { title: "Pick me", status: "todo", assigneeUsername: null });
    const asked = await nb(["task", "assign", "1", "--json"]);
    assert.equal(asked.code, 6);
    const q = JSON.parse(asked.stderr || asked.stdout).error.details.questions[0];
    assert.deepEqual(q.options.map((/** @type {any} */ o) => o.value), ["me", "@tester", "@sam", "none"]);
    const picked = await nb(["task", "assign", "1", "--answer", "person=@sam"]);
    assert.equal(picked.code, 0, picked.stderr);
    assert.equal(api.state.tasks[0]?.assigneeUsername, "sam");
  });

  it("the current task (C8): nb done and nb comment need no number; a nb/<n>- branch counts; the prompt shows it", async () => {
    api.state.tasks.length = 0;
    const t = addTask(api.state, { title: "Login bug", status: "todo" });
    assert.equal((await nb(["task", "start", "1"])).code, 0);
    const said = await nb(["comment", "found", "it"]);
    assert.equal(said.code, 0, said.stderr);
    assert.equal(t.comments.at(-1)?.content, "found it");
    assert.match((await nb(["prompt"])).stdout, /^\[#1\] $/);
    const done = await nb(["done", "-m", "fixed"]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(t.status, "done");
    assert.equal((await nb(["task", "stop"])).code, 0);
    // No started task: the git branch nb task start --branch made names it.
    const t2 = addTask(api.state, { title: "Footer", status: "todo" });
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".git", "HEAD"), `ref: refs/heads/nb/${t2.taskNumber}-footer\n`);
    const onBranch = await nb(["comment", "on", "the", "branch"]);
    assert.equal(onBranch.code, 0, onBranch.stderr);
    assert.equal(t2.comments.at(-1)?.content, "on the branch");
    assert.match((await nb(["prompt"])).stdout, new RegExp(`^\\[#${t2.taskNumber}\\] $`));
    fs.rmSync(path.join(cwd, ".git"), { recursive: true });
  });

  it("task count names the workspaces it covers (D24)", async () => {
    api.state.countWorkspaces = [{ id: "w1", title: "Design Lab", open: 2, overdue: 0, dueThisWeek: 1 }, { id: "w2", title: "Gstack", open: 1, overdue: 1, dueThisWeek: 0 }];
    const r = await nb(["task", "count"]);
    assert.match(r.stdout, /open tasks? across all your workspaces/);
    assert.match(r.stdout, /Gstack: 1 open, 1 overdue/);
    delete api.state.countWorkspaces;
    assert.match((await nb(["task", "count"])).stdout, / in Design Lab/);
  });

  it("nb ls is nb file list", async () => {
    const r = await nb(["ls"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr + r.stdout, /short for nb file list/);
  });
});
