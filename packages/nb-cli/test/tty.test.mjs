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

  // The matrix (A5.1, A5.5): widths × color levels × plain. Text must fit; color only when allowed.
  for (const cols of [40, 80, 120]) {
    for (const [name, env] of /** @type {Array<[string, Record<string, string>]>} */ ([["none", {}], ["16", { FORCE_COLOR: "1" }], ["truecolor", { FORCE_COLOR: "3", COLORTERM: "truecolor" }], ["plain", { FORCE_COLOR: "3", NB_PLAIN: "1" }]])) {
      it(`whoami and help at ${cols} columns, ${name} color`, async () => {
        const help = await runTty(["help"], { api: api.url, cols });
        for (const line of help.output.split("\n")) assert.ok([...line].length <= cols, `help wider than ${cols}: ${line}`);
        const r = await runTty(["whoami"], { api: api.url, cols, env: name === "none" ? env : { ...env, NO_COLOR: "" }, raw: true });
        assert.equal(r.code, 0, r.output);
        const colored = /\x1b\[[0-9;]*m/.test(r.output);
        assert.equal(colored, name === "16" || name === "truecolor", `color ${name}`);
        if (name === "truecolor") assert.match(r.output, /38;2;/);
        if (name === "plain") assert.doesNotMatch(r.output, /[●✓✗→…]/);
      });
    }
  }

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
