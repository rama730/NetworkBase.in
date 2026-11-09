import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
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
});
