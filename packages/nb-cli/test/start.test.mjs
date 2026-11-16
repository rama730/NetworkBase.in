import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C7 (M4d): npx @networkbase/cli start links this folder and pulls, asking only what it can't guess.
describe("nb start (C7)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("links the folder named like a workspace and pulls its files", async () => {
    const base = await tempDir("nb-start-");
    const cwd = path.join(base, "design-lab");
    fs.mkdirSync(cwd);
    const r = await runCli(["start", "--yes"], { api: api.url, cwd, home: await tempDir("nb-start-home-") });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(cwd, ".networkbase", "config.json")), "linked");
    assert.match(r.stdout, /Ready: linked this folder, pulled the files/);
  });

  it("an already linked folder just pulls; a folder it can't place asks which workspace", async () => {
    const cwd = await tempDir("nb-start2-");
    const home = await tempDir("nb-start2-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const linked = await runCli(["start"], { api: api.url, cwd, home });
    assert.equal(linked.code, 0, linked.stderr);
    assert.match(linked.stdout, /Ready: pulled the files/);
    const unknown = await runCli(["start"], { api: api.url, cwd: await tempDir("nb-start3-"), home });
    assert.equal(unknown.code, 6, "needs an answer: which workspace");
    assert.match(unknown.stderr, /Which workspace should this folder link to\?/);
  });
});
