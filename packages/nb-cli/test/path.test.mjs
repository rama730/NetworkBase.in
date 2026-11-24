import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.18 W9 (plan A7.7): nb path and nb path done.
describe("nb path", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).path = { done: ["a"], upNext: { stepId: "s1", lessonId: "b" }, steps: [
      { id: "s1", name: "Basics", progress: { done: 1, total: 2 }, locked: false, lessons: [{ id: "a", number: 410, title: "Variables" }, { id: "b", number: 411, title: "Loops" }] },
    ] };
  });
  after(() => api.close());

  it("shows steps, ticks and up next", async () => {
    const r = await runCli(["path", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1\. Basics\s+1 of 2 done\s+\[x\] Variables\s+NB-410\s+\[ \] Loops\s+NB-411\s+← up next/);
  });

  it("ticks and unticks by NB number", async () => {
    const r = await runCli(["path", "done", "NB-411", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /NB-411 done/);
    const u = await runCli(["path", "done", "411", "--undo", "-w", "design-lab"], { api: api.url });
    assert.match(u.stdout, /NB-411 not done/);
  });
});
