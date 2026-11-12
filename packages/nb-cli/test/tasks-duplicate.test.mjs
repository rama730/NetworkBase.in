import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Found by the D22 agent test (M4c): "make the release notes draft due Friday" created a second task. Creating one
// whose title an open task already has asks first: use that one, or make another.
describe("nb task create when the task already exists", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-dup-");
    home = await tempDir("nb-dup-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("asks (exit 6), then uses the existing one or makes another as answered", async () => {
    addTask(api.state, { title: "Release notes draft" });
    const before = api.state.tasks.length;
    const asked = await nb(["task", "create", "release notes draft"]);
    assert.equal(asked.code, 6, asked.stderr);
    assert.match(asked.stderr + asked.stdout, /#1 "Release notes draft" already exists/);
    const use = await nb(["task", "create", "release notes draft", "--answer", "duplicate=existing", "--json"]);
    assert.equal(use.code, 0, use.stderr);
    assert.deepEqual([JSON.parse(use.stdout).data.number, JSON.parse(use.stdout).data.existing], [1, true]);
    assert.equal(api.state.tasks.length, before, "nothing created");
    const another = await nb(["task", "create", "release notes draft", "--answer", "duplicate=new"]);
    assert.equal(another.code, 0, another.stderr);
    assert.equal(api.state.tasks.length, before + 1);
    assert.equal((await nb(["task", "create", "A brand new one"])).code, 0, "no match, no question");
  });
});
