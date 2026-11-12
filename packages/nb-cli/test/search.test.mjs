import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C2 (M4b): nb search across tasks, files, comments, docs and people, with --in to narrow it.
describe("nb search beyond files", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-search-");
    home = await tempDir("nb-search-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("finds a task, a file and a comment in one search", async () => {
    const t = addTask(api.state, { title: "Fix the login page" });
    t.comments.push({ id: "c1", authorUsername: "sam", content: "login button is grey" });
    putFile(api.state, "/login-notes.md", Buffer.from("x"));
    const r = await nb(["search", "login"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Tasks\n {2}#1 Fix the login page/);
    assert.match(r.stdout, /Files\n {2}\/login-notes\.md/);
    assert.match(r.stdout, /Comments\n {2}#1 @sam: login button is grey/);
    const only = JSON.parse((await nb(["search", "login", "--in", "tasks", "--json"])).stdout).data;
    assert.deepEqual([only.tasks.length, only.files.length, only.comments.length], [1, 0, 0]);
    assert.match((await nb(["search", "sam", "--in", "people"])).stdout, /@sam Sam Lee member/);
    assert.equal((await nb(["search", "x", "--in", "planets"])).code, 2);
  });
});
