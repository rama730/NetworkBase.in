import { it } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

// The MCP server is rebuilt in Phase 3 (P3.2); until then 2.x says so instead of running the 1.x one
// whose tool calls corrupted stdout (F5) and ignored ping (F6).
it("nb mcp explains it comes back with agent setup", async () => {
  const r = await runCli(["mcp"], { api: "http://127.0.0.1:1" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /rebuilt for 2\.0/);
  assert.equal(r.stdout, "", "nothing on stdout, where an MCP client would read");
});
