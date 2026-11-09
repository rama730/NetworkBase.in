import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { branchName, parseTasksMarkdown, taskTrailer } from "../lib/commands/extras.mjs";

// Report findings 146, 148, 149: git branches and trailers, saved filters, tasks from Markdown.
it("reads tasks, descriptions and subtasks from Markdown; names branches; finds trailers", () => {
  assert.deepEqual(parseTasksMarkdown("intro\n# Fix login\nUsers can't sign in.\n- [ ] Repro\n- [x] Patch\n## Write docs ##\n"), [
    { title: "Fix login", description: "Users can't sign in.", subtasks: ["Repro", "Patch"] },
    { title: "Write docs", description: "", subtasks: [] },
  ]);
  assert.equal(branchName(4, "Fix the Login page!"), "nb/4-fix-the-login-page");
  assert.equal(taskTrailer("Fix it\n\nNetworkBase-Task: #12\n"), "12");
  assert.equal(taskTrailer("no trailer"), null);
});

describe("extras in a linked git folder", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  const sh = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).toString();
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-extras-");
    home = await tempDir("nb-extras-home-");
    sh(["init", "-q", "-b", "main"]);
    await nb(["init", "design-lab"]);
    fs.writeFileSync(path.join(cwd, "seed.txt"), "x");
    sh(["add", "seed.txt"]);
    sh(["commit", "-q", "-m", "seed"]);
  });
  after(() => api.close());

  it("task start --branch creates and then reuses nb/<n>-<slug>", async () => {
    addTask(api.state, { title: "Fix login", status: "todo" });
    const r = await nb(["task", "start", "1", "--branch"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(sh(["branch", "--show-current"]).trim(), "nb/1-fix-login");
    sh(["switch", "-q", "main"]);
    assert.match((await nb(["task", "start", "1", "--branch"])).stdout, /switched/);
  });

  it("push --from-git pushes the last commit's files, to the trailer's task, with its subject", async () => {
    fs.writeFileSync(path.join(cwd, "login.ts"), "fixed");
    sh(["add", "login.ts"]);
    sh(["commit", "-q", "-m", "Fix the login check", "-m", "NetworkBase-Task: 1"]);
    const r = await nb(["push", "--from-git"]);
    assert.equal(r.code, 0, r.stderr);
    const placed = api.requests.filter((q) => q.path === "/api/v1/files/place").at(-1);
    assert.deepEqual(placed?.body.files.map((/** @type {any} */ f) => f.path), ["/login.ts"]);
    assert.equal(placed?.body.message, "Fix the login check");
    assert.equal(placed?.body.taskId, api.state.tasks[0]?.id);
  });

  it("saves a filter and uses it with @name", async () => {
    addTask(api.state, { title: "Blocked one", status: "blocked" });
    const saved = await nb(["task", "list", "--all", "--status", "blocked", "--save", "stuck", "--json"]);
    assert.deepEqual(JSON.parse(saved.stdout).data.tasks.map((/** @type {any} */ t) => t.title), ["Blocked one"]);
    const again = await nb(["task", "list", "@stuck", "--json"]);
    assert.deepEqual(JSON.parse(again.stdout).data.tasks.map((/** @type {any} */ t) => t.title), ["Blocked one"]);
    assert.equal((await nb(["task", "list", "@nope"])).code, 2);
  });

  it("task create --from tasks.md asks once, then creates each task with its subtasks", async () => {
    fs.writeFileSync(path.join(cwd, "tasks.md"), "# Plan sprint\n- [ ] Pick goals\n# Ship it\n");
    const before = api.state.tasks.length;
    assert.equal((await nb(["task", "create", "--from", "tasks.md"])).code, 7, "not a terminal: needs a yes");
    const r = await nb(["task", "create", "--from", "tasks.md", "--yes"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(api.state.tasks.slice(before).map((t) => t.title), ["Plan sprint", "Ship it"]);
    assert.equal(api.state.tasks[before]?.subtasks.length, 1);
  });
});
