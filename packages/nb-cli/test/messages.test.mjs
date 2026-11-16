import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report C4 (M4d): nb message list / read / send; the agent tool to send always needs a yes.
describe("nb message (C4)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  let cwd = "";
  let home = "";
  /** @param {string[]} args */
  const nb = (args) => runCli(args, { api: api.url, cwd, home });
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-msg-");
    home = await tempDir("nb-msg-home-");
  });
  after(() => api.close());

  it("lists conversations with what's new, and filters to unread", async () => {
    const r = await nb(["message", "list"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1  .* #design\s+design-lab\s+2 new/);
    assert.match(r.stdout, /@sam/);
    const unread = JSON.parse((await nb(["message", "list", "--unread", "--json"])).stdout);
    assert.deepEqual(unread.data.conversations.map((/** @type {any} */ c) => c.label), ["#design"]);
  });

  it("reads a conversation oldest first and marks it read; a name in two workspaces asks which", async () => {
    const ambiguous = await nb(["message", "read", "#design"]);
    assert.equal(ambiguous.code, 6, ambiguous.stderr);
    assert.match(ambiguous.stderr, /#design is in 2 workspaces/);
    const r = await nb(["message", "read", "#design", "--workspace", "design-lab"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /@sam[^\n]*\n\s+@me logo v2 is up\n\s+1 file: logo\.png\n\s+1 reply/);
    assert.match(r.stdout, /@ann[^\n]*\(edited\)/);
    assert.deepEqual(api.state.chatReads, [{ id: "c1", seq: 5 }]);
    const dm = await nb(["message", "read", "@sam"]);
    assert.match(dm.stdout, /No messages here yet/);
    assert.equal((await nb(["message", "read", "#nowhere"])).code, 1);
  });

  it("sends as you, by name or number, as a thread reply too", async () => {
    const r = await nb(["message", "send", "@sam", "thanks", "for", "the", "logo"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Sent to @sam/);
    const sent = api.requests.find((q) => q.method === "POST" && q.path === "/api/v1/chat/conversations/c2/messages");
    assert.deepEqual(sent?.body, { text: "thanks for the logo" });
    await nb(["message", "send", "1", "-m", "on it", "--reply", "4", "--workspace", "design-lab"]);
    assert.deepEqual(api.requests.filter((q) => q.path === "/api/v1/chat/conversations/c1/messages" && q.method === "POST").at(-1)?.body, { text: "on it", replyTo: 4 });
  });

  it("agent tools: reading and sending each wait for a yes (other people's words), and reading leaves them unread", async () => {
    const mcp = await startMcp({ api: api.url, cwd, home });
    try {
      await mcp.request("initialize", { protocolVersion: "2025-06-18" });
      const asked = await mcp.call("networkbase_message_list", {});
      assert.equal(asked.structuredContent.status, "needs_confirmation");
      const list = await mcp.call("networkbase_message_list", { confirmToken: asked.structuredContent.confirmToken });
      assert.equal(list.structuredContent.status, "ok", list.content[0].text);
      const readAsk = await mcp.call("networkbase_message_read", { conversation: "@sam" });
      assert.equal(readAsk.structuredContent.status, "needs_confirmation");
      const reads = (api.state.chatReads ?? []).length;
      const read = await mcp.call("networkbase_message_read", { conversation: "@sam", confirmToken: readAsk.structuredContent.confirmToken });
      assert.equal(read.structuredContent.status, "ok", read.content[0].text);
      assert.equal((api.state.chatReads ?? []).length, reads, "not marked read");
      const held = await mcp.call("networkbase_message_send", { conversation: "@sam", text: "hello" });
      assert.equal(held.structuredContent.status, "needs_confirmation");
      assert.match(held.structuredContent.summary, /Send to @sam as you: "hello"/);
    } finally { await mcp.close(); }
  });
});
