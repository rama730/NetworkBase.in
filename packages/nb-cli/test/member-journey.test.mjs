import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Member settings (report §7): nb workspace me, complete, reopen and leave with choices; the MCP tool is read-only.
describe("your part here from the terminal", () => {
  it("me, complete with a note and a task choice, reopen, and leave with the wrap-up check", async () => {
    /** @type {any[]} */
    const calls = [];
    const W = `/api/v1/workspaces/${WORKSPACE_ID}`;
    const part = (status) => ({
      workspace: { id: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", kind: "project", status: "active" },
      role: "member", isOwner: false, joinedAt: "2026-03-01T00:00:00Z", status,
      completion: status === "completed" ? { at: "2026-11-18T00:00:00Z", note: "Built the sign-in", by: { name: "Sam" }, byOwner: true, confirmedBy: { name: "Sam" }, confirmedAt: "2026-11-19T00:00:00Z" } : null,
      canDo: status === "completed" ? "Your part here is completed: you can read, comment and react." : "You can create and edit tasks.",
      periods: [], canComplete: status !== "completed", canReopen: status === "completed", canLeave: true, leaveRefusal: null,
      settings: { notifications: { version: 1, mode: "inherit", rules: {} }, muteUntil: null, agentsBlocked: false, hideAgentLabel: false, membersChooseLabels: false, viewPrefs: {}, showOnProfile: true },
    });
    let status = "active";
    const wrap = { workspace: { id: WORKSPACE_ID, title: "Design Lab", slug: "design-lab" }, openTasks: { count: 3, items: [] }, reviews: { count: 1, items: [] }, openWork: { changeSets: [], branches: [], mergeRequests: [], docDrafts: [] }, stays: "Your files stay." };
    const api = await startFakeServer({ routes: {
      [`GET ${W}/me`]: () => ({ data: part(status) }),
      [`GET ${W}/me/wrap-up`]: () => ({ data: wrap }),
      [`POST ${W}/me/complete`]: (/** @type {any} */ req) => { calls.push(["complete", req.body]); status = "completed"; return { data: { part: part(status), undoId: "u1", undoToken: "u1", already: false, undone: "Completed your part" } }; },
      [`POST ${W}/me/reopen`]: () => { calls.push(["reopen"]); status = "active"; return { data: part(status) }; },
      [`DELETE ${W}/members`]: (/** @type {any} */ req) => { calls.push(["leave", req.body]); return { data: { left: true, undoId: "u2", undoToken: "u2" } }; },
    } });
    try {
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const me = await runCli(["workspace", "me"], { api: api.url, env });
      assert.equal(me.code, 0, me.stderr);
      assert.match(me.stdout, /Design Lab · member since Mar 2026/);
      assert.match(me.stdout, /Active/);

      assert.notEqual((await runCli(["workspace", "complete", "--keep", "--unassign", "--yes"], { api: api.url, env })).code, 0, "one task choice");
      const done = await runCli(["workspace", "complete", "-m", "Built the sign-in", "--give-tasks-to", "@sam", "--yes"], { api: api.url, env });
      assert.equal(done.code, 0, done.stderr);
      assert.match(done.stdout, /Your part is completed/);
      assert.match(done.stdout, /nb undo/);

      const after = await runCli(["workspace", "me", "--json"], { api: api.url, env });
      const body = JSON.parse(after.stdout);
      assert.equal(body.data.status, "completed");
      const human = await runCli(["workspace", "me"], { api: api.url, env });
      assert.match(human.stdout, /Completed · 18 Nov 2026 · "Built the sign-in" · marked by Sam · confirmed by Sam/);

      assert.equal((await runCli(["workspace", "reopen"], { api: api.url, env })).code, 0);
      assert.notEqual((await runCli(["workspace", "leave", "--keep", "--yes"], { api: api.url, env })).code, 0, "leaving can't keep tasks");
      const left = await runCli(["workspace", "leave", "--yes"], { api: api.url, env });
      assert.equal(left.code, 0, left.stderr);
      assert.match(left.stdout, /You left the workspace · nb undo to undo/);

      assert.deepEqual(calls, [
        ["complete", { tasks: "give", giveTo: "sam", note: "Built the sign-in" }],
        ["reopen"],
        ["leave", { leave: true, tasks: "unassign" }],
      ]);
    } finally {
      await api.close();
    }
  });
});

describe("agents and your part", () => {
  it("networkbase_my_part is read-only, and no tool completes, reopens or leaves", async () => {
    const { TOOLS } = await import("../lib/mcp/tools.mjs");
    const mine = TOOLS.find((t) => t.name === "networkbase_my_part");
    assert.ok(mine);
    assert.equal(mine.tier, "read");
    assert.deepEqual(TOOLS.filter((t) => /complete_part|reopen|leave/.test(t.name)).map((t) => t.name), []);
  });
});
