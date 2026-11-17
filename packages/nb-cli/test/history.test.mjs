import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report H3, H6 (M8, phase H-1): nb log lists saves, nb show opens one by its number (and one file's diff), nb revert
// makes a new save that undoes one; a conflict leaves a change set to resolve and exits 4.
const ID = "5a5e0000-0000-4000-8000-000000000012";
const save = { id: ID, number: 12, kind: "save", message: "Fix the greeting", author: { id: "u1", name: "Tester", username: "tester" }, via: "agent", agentName: "Claude Code", task: { id: "t4", number: 4 }, changeSetId: null, revertsSaveId: null, files: { added: 0, changed: 1, deleted: 0, renamed: 0 }, createdAt: "2026-11-17T09:00:00.000Z" };

function server(revert = /** @type {any} */ ({ outcome: "reverted", changeSetId: "c5000000-0000-4000-8000-000000000001", saveId: "5a5e0000-0000-4000-8000-000000000013" })) {
  return startFakeServer({ routes: {
    [`GET /api/v1/workspaces/${WORKSPACE_ID}/saves`]: (/** @type {any} */ req) => ({ data: { saves: !req.query.get("number") || req.query.get("number") === "12" ? [save] : [], nextCursor: null } }),
    [`GET /api/v1/saves/${ID}`]: () => ({ data: { save, workspaceId: WORKSPACE_ID, files: [{ path: "/src/hello.ts", fromPath: null, op: "change", size: 20, mimeType: "text/plain", version: 2, previousVersion: 1 }], truncated: false } }),
    [`GET /api/v1/saves/${ID}/diff`]: (/** @type {any} */ req) => ({ data: { kind: "text", added: 1, removed: 1, lines: [{ kind: "@", text: "@@ -1 +1 @@" }, { kind: "-", text: `hi ${req.query.get("path")}` }, { kind: "+", text: "hello" }] } }),
    [`POST /api/v1/saves/${ID}/revert`]: () => ({ data: revert }),
  } });
}

describe("nb log, nb show, nb revert (H3)", () => {
  it("lists saves, shows one by number with a diff, filters by path", async () => {
    const api = await server();
    try {
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const log = await runCli(["log", "src", "--author", "tester"], { api: api.url, env });
      assert.equal(log.code, 0, log.stderr);
      assert.match(log.stdout, /12\s+Fix the greeting/);
      assert.match(log.stdout, /@tester with Claude Code/);
      const listed = api.requests.find((r) => r.path.endsWith("/saves"));
      assert.equal(listed?.query.get("path"), "src");
      assert.equal(listed?.query.get("author"), "tester");
      const show = await runCli(["show", "12"], { api: api.url, env });
      assert.equal(show.code, 0, show.stderr);
      assert.match(show.stdout, /Save 12/);
      assert.match(show.stdout, /~ \/src\/hello\.ts/);
      const diff = await runCli(["show", "12", "--diff", "/src/hello.ts", "--json"], { api: api.url, env });
      assert.equal(JSON.parse(diff.stdout).schema, "nb.show.diff/1");
      const missing = await runCli(["show", "99"], { api: api.url, env });
      assert.notEqual(missing.code, 0);
      assert.match(missing.stderr, /No save 99/);
    } finally { await api.close(); }
  });

  it("revert asks, then reverts; a conflict exits 4 with how to resolve", async () => {
    const env = { NB_WORKSPACE: WORKSPACE_ID };
    let api = await server();
    try {
      const done = await runCli(["revert", "12", "--yes", "--json"], { api: api.url, env });
      assert.equal(done.code, 0, done.stderr);
      assert.equal(JSON.parse(done.stdout).data.outcome, "reverted");
    } finally { await api.close(); }
    api = await server({ outcome: "conflicts", changeSetId: "c5000000-0000-4000-8000-000000000001", saveId: null, conflicts: [{ path: "/src/hello.ts" }] });
    try {
      const held = await runCli(["revert", "12", "--yes"], { api: api.url, env });
      assert.equal(held.code, 4, held.stderr);
      assert.match(held.stdout, /nb change view c5000000/);
    } finally { await api.close(); }
  });
});
