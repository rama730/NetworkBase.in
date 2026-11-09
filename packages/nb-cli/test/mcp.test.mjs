import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { mcpSession, isJsonRpcLine } from "./helpers/mcp-session.mjs";

describe("nb mcp (1.x)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("answers initialize and tools/list with JSON-RPC only", async () => {
    const s = await mcpSession(api.url);
    try {
      s.send({ id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      const init = await s.reply(1);
      assert.equal(init.result.serverInfo.name, "networkbase-cli-mcp");
      s.send({ id: 2, method: "tools/list" });
      const list = await s.reply(2);
      assert.ok(list.result.tools.length > 0);
      assert.ok(s.lines.every(isJsonRpcLine), s.lines.join("\n"));
    } finally {
      s.close();
    }
  });

  // F5: command handlers print their own JSON to stdout before the JSON-RPC reply. Fixed in Phase 3 (P3.2).
  it("keeps stdout JSON-RPC only during tools/call", { todo: "F5 — fixed in P3.2" }, async () => {
    const s = await mcpSession(api.url);
    try {
      s.send({ id: 1, method: "tools/call", params: { name: "nb_auth_status", arguments: {} } });
      await s.reply(1);
      assert.ok(s.lines.every(isJsonRpcLine), s.lines.join("\n"));
    } finally {
      s.close();
    }
  });

  // F6: requests other than initialize/tools are never answered. Fixed in Phase 3 (P3.2).
  it("answers ping", { todo: "F6 — fixed in P3.2" }, async () => {
    const s = await mcpSession(api.url);
    try {
      s.send({ id: 7, method: "ping" });
      const pong = await s.next(1500);
      assert.equal(pong.id, 7);
    } finally {
      s.close();
    }
  });
});
