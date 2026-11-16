import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toolList } from "../lib/mcp/tools.mjs";
import { putFile, startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report G14 (M6): a cloud agent with no folder works on the workspace's files. The first write opens a change set
// for its session, later writes and reads use it, and a set closed elsewhere is replaced, not written into.
describe("nb fs (G14)", () => {
  it("opens one change set for the session, reads through it, starts again after it's closed, and applies", async () => {
    const api = await startFakeServer();
    try {
      putFile(api.state, "/src/app.ts", Buffer.from("export const a = 1;\n"));
      const home = await tempDir("nb-fs-h-");
      const nb = (/** @type {string[]} */ args) => runCli([...args, "--json"], { api: api.url, home, env: { NB_WORKSPACE: WORKSPACE_ID, NB_AGENT_SESSION: "s1" } });
      const starts = () => api.requests.filter((r) => r.method === "POST" && r.path.endsWith("/change-sets")).length;

      const w1 = await nb(["fs", "write", "/src/new.ts", "--text", "export const b = 2;\n", "--title", "Add b"]);
      assert.equal(w1.code, 0, w1.stderr);
      const first = JSON.parse(w1.stdout).data.changeSet;
      assert.equal((await nb(["fs", "write", "/src/app.ts", "--text", "export const a = 3;\n"])).code, 0);
      assert.equal(starts(), 1, "one change set for the session");
      assert.equal(api.requests.find((r) => r.path.endsWith("/change-sets") && r.method === "POST")?.body.title, "Add b");

      const read = JSON.parse((await nb(["fs", "read", "/src/app.ts", "/src/new.ts"])).stdout).data.files;
      assert.deepEqual(read.map((/** @type {any} */ f) => f.text), ["export const a = 3;\n", "export const b = 2;\n"]);
      const lastRead = api.requests.filter((r) => r.path.endsWith("/fs/read")).at(-1);
      assert.equal(lastRead?.query.get("changeSet"), first);
      assert.deepEqual(lastRead?.query.getAll("path"), ["/src/app.ts", "/src/new.ts"]);
      const edited = await nb(["fs", "edit", "/src/app.ts", "--edits", JSON.stringify([{ oldText: "a = 3", newText: "a = 4" }, { oldText: "export ", newText: "export default " }])]);
      assert.equal(edited.code, 0, edited.stderr);
      assert.deepEqual(api.requests.filter((r) => r.path.endsWith("/fs/edit")).at(-1)?.body.edits.length, 2);
      assert.equal(JSON.parse((await nb(["fs", "read", "/src/app.ts"])).stdout).data.files[0].text, "export default const a = 4;\n");
      const found = JSON.parse((await nb(["fs", "search", "const b"])).stdout).data.matches;
      assert.deepEqual(found, [{ path: "/src/new.ts", line: 1, text: "export const b = 2;" }]);

      // Another session (another MCP connection) gets its own change set.
      const other = await runCli(["fs", "write", "/x.ts", "--text", "x", "--json"], { api: api.url, home, env: { NB_WORKSPACE: WORKSPACE_ID, NB_AGENT_SESSION: "s2" } });
      assert.notEqual(JSON.parse(other.stdout).data.changeSet, first);

      const applied = await nb(["fs", "finish", "--apply"]);
      assert.equal(applied.code, 0, applied.stderr);
      assert.equal(api.state.files.get("/src/new.ts")?.content.toString(), "export const b = 2;\n");
      const next = await nb(["fs", "write", "/src/c.ts", "--text", "c"]);
      assert.notEqual(JSON.parse(next.stdout).data.changeSet, first, "after apply, the next write opens a new one");

      // Discarded in the app meanwhile: the write goes to a new change set, never fails.
      const current = JSON.parse(next.stdout).data.changeSet;
      await runCli(["change", "discard", current, "--yes"], { api: api.url, home, env: { NB_WORKSPACE: WORKSPACE_ID } });
      const after = await nb(["fs", "write", "/src/d.ts", "--text", "d"]);
      assert.equal(after.code, 0, after.stderr);
      assert.notEqual(JSON.parse(after.stdout).data.changeSet, current);
    } finally { await api.close(); }
  });

  it("finish with nothing written says so", async () => {
    const api = await startFakeServer();
    try {
      const res = await runCli(["fs", "finish"], { api: api.url, env: { NB_WORKSPACE: WORKSPACE_ID, NB_AGENT_SESSION: "none" } });
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /nothing written yet/);
    } finally { await api.close(); }
  });

  it("only the hosted server lists the fs_* tools; nb mcp on a computer has the folder", () => {
    const hosted = toolList(true).map((t) => t.name);
    const local = toolList(false).map((t) => t.name);
    for (const name of ["fs_list", "fs_read", "fs_search", "fs_edit", "fs_write", "fs_delete", "fs_move", "fs_finish"]) {
      assert.ok(hosted.includes(name), name);
      assert.ok(!local.includes(name), name);
    }
  });
});
