import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C1 (M4d): nb learn runs the everyday loop in a practice workspace and deletes it at the end.
describe("nb learn (C1)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("links, pushes, starts and finishes a task in the practice workspace, then deletes it; the folder it was run in is untouched", async () => {
    const cwd = await tempDir("nb-learn-");
    const home = await tempDir("nb-learn-home-");
    const r = await runCli(["learn"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    for (const step of ["Step 1 of 5: Link a folder", "Step 3 of 5: Push it", "Step 5 of 5: Finish it"]) assert.match(r.stderr, new RegExp(step));
    assert.ok(api.state.files.has("notes.md") || [...api.state.files.keys()].some((k) => k.endsWith("notes.md")), "the practice file was pushed");
    assert.ok(api.state.tasks.some((/** @type {any} */ t) => t.title === "Try NetworkBase" && t.status === "done"), "the practice task was finished");
    assert.deepEqual(api.state.sandboxesEnded, [api.state.workspace.id]);
    assert.match(r.stdout, /That's the everyday loop/);
    const { readdirSync } = await import("node:fs");
    assert.deepEqual(readdirSync(cwd), [], "nothing written where it was run");
  });

  it("a practice workspace it didn't make (kept, or another terminal's) is left alone; --json stays one result", async () => {
    api.state.sandboxExists = true;
    const before = (api.state.sandboxesEnded ?? []).length;
    const r = await runCli(["learn", "--json"], { api: api.url, cwd: await tempDir("nb-learn-x-"), home: await tempDir("nb-learn-xh-") });
    api.state.sandboxExists = false;
    assert.equal(r.code, 0, r.stderr);
    assert.equal((api.state.sandboxesEnded ?? []).length, before, "not deleted");
    const out = JSON.parse(r.stdout);
    assert.equal(out.data.kept, true);
  });

  it("--keep leaves the practice workspace for 24 hours", async () => {
    const before = (api.state.sandboxesEnded ?? []).length;
    const r = await runCli(["learn", "--keep"], { api: api.url, cwd: await tempDir("nb-learn-k-"), home: await tempDir("nb-learn-kh-") });
    assert.equal(r.code, 0, r.stderr);
    assert.equal((api.state.sandboxesEnded ?? []).length, before);
    assert.match(r.stdout, /stays for 24 hours/);
  });
});
