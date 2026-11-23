import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.9 W12 (plan A2.10): nb roadmap list|add.
describe("nb roadmap", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).roadmap = [
      { id: "r3", number: 152, title: "Alpha build", stage: "backlog", column: "later", type: "milestone", milestone: "Alpha", progress: null },
      { id: "r1", number: 150, title: "SSO sign-in", stage: "in_progress", column: "now", type: "feature", progress: 50 },
      { id: "r2", number: 151, title: "Faster search", stage: "planned", column: "next", type: "improvement", progress: null },
      { id: "r4", number: 153, title: "Old export", stage: "launched", column: "now", type: "fix", progress: 100 },
    ];
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("list orders Now, Next, Later and leaves Launched out; --now keeps one column", async () => {
    const all = await nb(["roadmap", "list", "--json"]);
    assert.equal(all.code, 0, all.stderr);
    assert.deepEqual(JSON.parse(all.stdout).data.items.map((/** @type {any} */ i) => i.number), [150, 151, 152]);
    const now = await nb(["roadmap", "list", "--now", "--json"]);
    assert.deepEqual(JSON.parse(now.stdout).data.items.map((/** @type {any} */ i) => i.number), [150]);
  });

  it("add sends the type, column and outcome at Backlog; a milestone takes its name", async () => {
    const r = await nb(["roadmap", "add", "SSO sign-in", "--type", "feature", "--column", "next", "--outcome", "People sign in with SSO"]);
    assert.equal(r.code, 0, r.stderr);
    const body = api.state.lastCreate;
    assert.deepEqual({ itemType: body.itemType, stage: body.stage, typeFields: body.typeFields }, { itemType: "roadmap_item", stage: "backlog", typeFields: { column: "next", itemType: "feature", outcome: "People sign in with SSO" } });
    assert.equal((await nb(["roadmap", "add", "Beta", "--type", "milestone", "--milestone", "beta"])).code, 0);
    assert.deepEqual(api.state.lastCreate.typeFields, { column: "next", itemType: "milestone", milestone: "Beta" });
    assert.match((await nb(["roadmap", "add", "X", "--column", "soon"])).stderr, /use now, next or later/);
    assert.match((await nb(["roadmap", "add", "X", "--milestone", "Alpha"])).stderr, /goes with --type milestone/);
  });
});
