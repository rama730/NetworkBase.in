import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { runTty, TTY_SUPPORTED } from "./helpers/run-tty.mjs";
import { matchSnapshot } from "./helpers/snapshot.mjs";
import { tempDir } from "./helpers/run-cli.mjs";

describe("nb in a terminal", { skip: !TTY_SUPPORTED && "needs a pseudo-terminal (macOS/Linux)" }, () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("prints help at 80 columns", async () => {
    const r = await runTty(["help"], { api: api.url, cols: 80 });
    assert.equal(r.code, 0, r.output);
    matchSnapshot("help-80", r.output);
  });

  it("asks a question with numbered options and takes a keypress (report §20.3)", async () => {
    const cwd = await tempDir("nb-tty-proj-");
    const r = await runTty(["init"], { api: api.url, keys: ["1"], cwd });
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /Which workspace should this folder link to\?/);
    assert.match(r.output, /Recommended/);
    assert.match(r.output, /Linked this folder to Design Lab/);
    assert.ok(fs.existsSync(path.join(cwd, ".networkbase", "config.json")));
  });

  for (const cols of [40, 120]) {
    it(`task list fits ${cols} columns`, async () => {
      const cwd = await tempDir("nb-tty-proj-");
      const home = await tempDir("nb-tty-home-");
      await runCli(["init", "design-lab"], { api: api.url, cwd, home });
      if (!api.state.tasks.length) {
        addTask(api.state, { title: "Rewrite the onboarding checklist so new members see their first task", status: "in_progress" });
        addTask(api.state, { title: "Fix login", priority: "high" });
      }
      const r = await runTty(["task", "list"], { api: api.url, cols, cwd, env: { HOME: home } });
      assert.equal(r.code, 0, r.output);
      for (const line of r.output.split("\n")) assert.ok([...line].length <= cols, `wider than ${cols}: ${line}`);
      matchSnapshot(`task-list-${cols}`, r.output);
    });
  }
});
