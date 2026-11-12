import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report A2.8, A2.9, §26.6: undo the last change from this machine; an agent's big change waits for a yes.
describe("nb undo and held changes", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-undo-");
    home = await tempDir("nb-undo-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  afterEach(() => api.close());

  it("nb undo reverses the last push from this machine, once", async () => {
    fs.writeFileSync(path.join(cwd, "a.txt"), "hello");
    assert.equal((await runCli(["push", "a.txt"], { api: api.url, cwd, home })).code, 0);
    const list = await runCli(["undo", "--list", "--json"], { api: api.url, cwd, home });
    assert.equal(JSON.parse(list.stdout).data.changes[0].what, "push");
    const r = await runCli(["undo"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Undid the push of 1 file/);
    assert.doesNotMatch(r.stdout, /\(/, "one plain sentence, no doubled wording (C16 #6)");
    assert.deepEqual(api.state.undone[0].paths, ["/a.txt"]);
    const again = await runCli(["undo"], { api: api.url, cwd, home });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /Nothing to undo/);
  });

  it("an agent's finish is held: exit 7 with the token, then --confirm sends the yes", async () => {
    const t = addTask(api.state, { title: "Ship", status: "in_progress" });
    const agent = "nb_agt_0123456789abcdef0123";
    const held = await runCli(["task", "done", String(t.taskNumber), "-m", "Done", "--json"], { api: api.url, cwd, home, token: agent });
    assert.equal(held.code, 7, held.stderr);
    const err = JSON.parse(held.stdout).error;
    assert.equal(err.details.confirmToken, "srv.yes-token");
    assert.equal(api.state.tasks[0]?.status, "in_progress");
    const ok = await runCli(["task", "done", String(t.taskNumber), "-m", "Done", "--confirm", err.details.confirmToken], { api: api.url, cwd, home, token: agent });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(api.state.tasks[0]?.status, "done");
  });

  // Found in the live check (2026-11-10): an agent's rename asked locally, then the server held it again: two yeses.
  it("an agent's rename isn't asked here first: the server holds it, so the person is asked once", async () => {
    putFile(api.state, "/a.txt", Buffer.from("a"));
    const mine = await runCli(["file", "rename", "/a.txt", "b.txt", "--json"], { api: api.url, cwd, home });
    assert.equal(mine.code, 7, "a person's token still asks here");
    const agent = await runCli(["file", "rename", "/a.txt", "b.txt", "--json"], { api: api.url, cwd, home, token: "nb_agt_0123456789abcdef0123" });
    assert.equal(agent.code, 0, agent.stderr);
    assert.equal(api.state.fileOps.at(-1)?.kind, "rename");
  });

  it("through MCP the server's hold comes back as needs_confirmation, and the yes goes to the server", async () => {
    const t = addTask(api.state, { title: "Ship", status: "in_progress" });
    const mcp = await startMcp({ api: api.url, cwd, home, token: "nb_agt_0123456789abcdef0123" });
    try {
      const first = (await mcp.request("tools/call", { name: "networkbase_task_done", arguments: { task: String(t.taskNumber), summary: "Done" } })).result;
      assert.equal(first.structuredContent.status, "needs_confirmation", first.content[0].text);
      assert.equal(first.structuredContent.by, "server", "asked once, by the server");
      const second = (await mcp.request("tools/call", { name: "networkbase_task_done", arguments: { task: String(t.taskNumber), summary: "Done", confirmToken: first.structuredContent.confirmToken } })).result;
      assert.equal(second.structuredContent.status, "ok", second.content[0].text);
      assert.equal(api.state.tasks[0]?.status, "done");
    } finally {
      await mcp.close();
    }
  });
});
