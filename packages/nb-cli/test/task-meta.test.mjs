import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C2, C3, C11, C12 (0087): labels, "blocked by", links, watch, star; starred and recent files.
describe("task and file details (M4b)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-meta-");
    home = await tempDir("nb-meta-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("labels, blocked by and a pull request link; the task view shows them on one screen", async () => {
    addTask(api.state, { title: "Login bug" });
    addTask(api.state, { title: "API keys" });
    const r = await nb(["task", "edit", "1", "--label", "Bug,ui", "--blocked-by", "2", "--link", "https://github.com/acme/app/pull/42"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /labels \[bug\] \[ui\]/);
    assert.match(r.stdout, /waiting on #2/);
    const view = await nb(["task", "view", "1"]);
    assert.match(view.stdout, /\[bug\] \[ui\]/);
    assert.match(view.stdout, /Waiting on #2 API keys/);
    assert.match(view.stdout, /PR acme\/app#42/);
    assert.match((await nb(["task", "view", "2"])).stdout, /Blocks #1/);
    assert.equal((await nb(["task", "edit", "1", "2", "--label", "x"])).code, 2, "one task at a time");
    const listed = await nb(["task", "list", "--label", "bug"]);
    assert.equal(api.state.lastListQuery?.get("label"), "bug");
    // Everyone's tasks with the label, not only yours (M4b live check).
    assert.equal(api.state.lastListQuery?.get("scope"), "all");
    assert.match(listed.stdout, /\[bug\]/);
  });

  it("watch and star are yours, with --off", async () => {
    assert.match((await nb(["task", "watch", "1"])).stdout, /Watching #1/);
    assert.match((await nb(["task", "star", "1"])).stdout, /Starred #1/);
    assert.match((await nb(["task", "view", "1"])).stdout, /★ · watching/);
    assert.match((await nb(["task", "star", "1", "--off"])).stdout, /Unstarred #1/);
    await nb(["task", "list", "--starred"]);
    assert.deepEqual([api.state.lastListQuery?.get("starred"), api.state.lastListQuery?.get("scope")], ["1", "all"]);
  });

  it("starred files are shared with the Files tab; recent lists what you changed", async () => {
    putFile(api.state, "/notes.md", Buffer.from("a"));
    putFile(api.state, "/plan.md", Buffer.from("b"));
    assert.match((await nb(["file", "star", "notes.md"])).stdout, /Starred \/notes.md · the Files tab shows it too/);
    const starred = await nb(["file", "list", "--starred"]);
    assert.match(starred.stdout, /\/notes\.md/);
    assert.doesNotMatch(starred.stdout, /plan\.md/);
    assert.match((await nb(["file", "recent"])).stdout, /\/plan\.md/);
    await nb(["file", "star", "notes.md", "--off"]);
    assert.match((await nb(["file", "list", "--starred"])).stdout, /No starred files/);
  });
  it("nb task remind sets, lists and cancels your reminders", async () => {
    const set = await nb(["task", "remind", "1", "tomorrow 9am", "-m", "check CI"]);
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /I'll remind you about #1/);
    assert.match((await nb(["task", "remind", "1", "--list"])).stdout, /check CI/);
    assert.equal((await nb(["task", "remind", "1", "someday"])).code, 2);
    assert.match((await nb(["task", "remind", "1", "--off"])).stdout, /Cancelled 1 reminder on #1/);
    assert.match((await nb(["task", "remind", "1"])).stdout, /No reminders on #1/);
  });
});
