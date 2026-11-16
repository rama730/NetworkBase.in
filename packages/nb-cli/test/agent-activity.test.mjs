import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report F4 (M6): nb agent activity groups your agents' work by session, and --undo undoes one session's changes,
// newest first, going on past one that can't be undone. nb agent pause / resume flip the workspace's switch.
const S1 = "3f2a9c1e-0000-4000-8000-000000000001";
const S2 = "7b11d0aa-0000-4000-8000-000000000002";

describe("nb agent activity, pause, resume (F4)", () => {
  it("lists sessions, and undoes one session's undoable changes newest first", async () => {
    const sessions = [
      { session: S1, agent: "Claude Code", changes: [{ id: "u2", summary: "Moved #4 to review", undoable: true, undone: false }, { id: "u1", summary: "Ticked a subtask", undoable: true, undone: false }, { id: "u0", summary: "Old", undoable: false, undone: true }] },
      { session: S2, agent: "Codex", changes: [{ id: "u9", summary: "Commented on #7", undoable: true, undone: false }] },
    ];
    const api = await startFakeServer({ routes: { [`GET /api/v1/workspaces/${WORKSPACE_ID}/agents`]: () => ({ data: { sessions } }) } });
    try {
      api.state.undos.set("u2", { kind: "task" });
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const list = await runCli(["agent", "activity"], { api: api.url, env });
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /Claude Code/);
      assert.match(list.stdout, /nb agent activity --undo 3f2a9c1e/);
      // u1 is gone on the server (someone changed it since): the rest still goes, and the exit says not all did.
      const undo = await runCli(["agent", "activity", "--undo", "3f2a", "--yes", "--json"], { api: api.url, env });
      assert.equal(undo.code, 4, undo.stderr);
      const results = JSON.parse(undo.stdout).data.results;
      assert.deepEqual(results.map((/** @type {any} */ r) => [r.id, r.ok]), [["u2", true], ["u1", false]]);
      assert.ok(!api.requests.some((r) => r.path === "/api/v1/undo/u9"), "the other session is untouched");
      const none = await runCli(["agent", "activity", "--undo", "zzzz", "--yes"], { api: api.url, env });
      assert.notEqual(none.code, 0);
    } finally { await api.close(); }
  });

  it("pause and resume send the switch", async () => {
    /** @type {any[]} */
    const bodies = [];
    const api = await startFakeServer({ routes: { [`POST /api/v1/workspaces/${WORKSPACE_ID}/agents`]: (/** @type {any} */ req) => { bodies.push(req.body); return { data: { paused: req.body.paused } }; } } });
    try {
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const paused = await runCli(["agent", "pause"], { api: api.url, env });
      assert.equal(paused.code, 0, paused.stderr);
      assert.match(paused.stdout, /paused/);
      assert.equal((await runCli(["agent", "resume"], { api: api.url, env })).code, 0);
      assert.deepEqual(bodies, [{ paused: true }, { paused: false }]);
    } finally { await api.close(); }
  });
});
