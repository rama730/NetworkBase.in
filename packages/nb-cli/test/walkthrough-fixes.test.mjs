import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C16: the walkthrough findings (Part E results, 12 Nov 2026).
describe("walkthrough fixes (C16)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c16-");
    home = await tempDir("nb-c16-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("1: push links files to the started task, and --no-task opts out", async () => {
    const t = addTask(api.state, { title: "Fix login copy", status: "todo" });
    assert.equal((await nb(["task", "start", String(t.taskNumber)])).code, 0);
    fs.writeFileSync(path.join(cwd, "copy.md"), "hi");
    const pushed = await nb(["push", "copy.md", "-m", "draft"]);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout, new RegExp(`to #${t.taskNumber} Fix login copy`));
    assert.deepEqual(t.files.map((/** @type {any} */ f) => f.path), ["/copy.md"]);
    fs.writeFileSync(path.join(cwd, "other.md"), "x");
    await nb(["push", "other.md", "--no-task"]);
    assert.deepEqual(t.files.map((/** @type {any} */ f) => f.path), ["/copy.md"], "--no-task leaves the task alone");
  });

  it("2: a named file over the limit is an error with the size and the limit", async () => {
    fs.writeFileSync(path.join(cwd, "big.bin"), Buffer.alloc(11 * 1024 * 1024));
    const r = await nb(["push", "big.bin"]);
    assert.equal(r.code, 5, "blocked");
    assert.match(r.stderr, /big\.bin is 11 MB; files can be up to 10 MB/);
    fs.rmSync(path.join(cwd, "big.bin"));
  });

  it("3: create takes due, who and sprint at once, says the next step; start assigns an unassigned task to you", async () => {
    const r = await nb(["task", "create", "Update the logo", "--due", "2026-12-01", "--to", "@sam"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.lastCreate.dueDate, api.state.lastCreate.assigneeId], ["2026-12-01", "bbbbbbbb-2222-4222-8222-222222222222"]);
    assert.match(r.stdout, /Next: nb task start \d+/);
    const mine = await nb(["task", "create", "Mine by default"]);
    assert.equal(api.state.lastCreate.assigneeId, undefined, "left out: the server makes it yours");
    assert.equal(mine.code, 0);
    const bad = await nb(["task", "create", "When?", "--due", "someday"]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /isn't a date I know/);
    const loose = addTask(api.state, { title: "Nobody's", assigneeUsername: null, status: "todo" });
    api.state.detailReads = [];
    const started = await nb(["task", "start", String(loose.taskNumber)]);
    assert.match(started.stdout, /assigned to you/);
    assert.match(started.stdout, /Moved to In progress/, "the move isn't refused by the assign changing the task");
    assert.deepEqual([loose.assigneeUsername, loose.status], ["tester", "in_progress"]);
    assert.deepEqual(api.state.detailReads, ["brief"], "C16 #9: start reads the short task only");
  });

  it("12: nb class is nb assignment, so the Classes group in help works as typed", async () => {
    const { resolveCommand } = await import("../lib/args.mjs");
    assert.equal(resolveCommand(["class", "list"]).spec?.name, "assignment list");
    assert.equal(resolveCommand(["class", "view", "3"]).spec?.name, "assignment view");
    assert.equal(resolveCommand(["class", "list"]).alias, null, "a synonym, not a renamed command: no reminder");
    assert.throws(() => resolveCommand(["class"]), /needs an action: list, view/);
  });

  it("4: the started task's marker never reads as a minus sign in --plain", async () => {
    const r = await nb(["task", "list", "--all", "--plain"]);
    assert.doesNotMatch(r.stdout, /(^|\s)-\d+\s/m);
    assert.match(r.stdout, /> \d+ /);
  });

  it("5: a freshly linked folder says how many files wait on the server, in one line", async () => {
    const fresh = await startFakeServer();
    try {
      for (let i = 0; i < 30; i++) putFile(fresh.state, `/docs/page-${i}.md`, Buffer.from(`page ${i}`));
      const dir = await tempDir("nb-c16-fresh-");
      await runCli(["init", "design-lab"], { api: fresh.url, cwd: dir, home });
      fs.writeFileSync(path.join(dir, "mine.md"), "local");
      const r = await runCli(["status"], { api: fresh.url, cwd: dir, home });
      assert.match(r.stdout, /30 files on the server · nb pull to get them/);
      assert.doesNotMatch(r.stdout, /page-1\.md/, "no row per waiting file");
      assert.match(r.stdout, /mine\.md/, "local changes still listed");
    } finally { fresh.close(); }
  });

  it("7: whoami describes your own sign-in in a sentence", async () => {
    const r = await runCli(["whoami"], { api: api.url, cwd, home, token: "nb_dev_0123456789abcdef0123" });
    assert.match(r.stdout, /token +device · .*all your workspaces/);
    assert.match(r.stdout, /access +Your own sign-in: does what you can, in all your workspaces, until 6 Nov 2027\./);
  });
});
