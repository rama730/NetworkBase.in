import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report §20.4, §26.4: ask a person in NetworkBase and wait for the answer; answer agents' questions.
describe("nb ask", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-ask-");
    home = await tempDir("nb-ask-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  afterEach(() => api.close());

  it("asks with options (first recommended) and waits for the answer", async () => {
    api.state.autoAnswer = "csv";
    const r = await runCli(["ask", "Export as CSV or Excel?", "--option", "CSV: smaller", "--option", "Excel", "--wait", "--json"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    const q = api.state.questions[0];
    assert.deepEqual(q.questions[0].options.map((/** @type {any} */ o) => [o.value, Boolean(o.recommended)]), [["csv", true], ["excel", false]]);
    assert.equal(q.questions[0].options[0].description, "smaller");
    assert.deepEqual(JSON.parse(r.stdout).data.answer, { answer: "csv" });
  });

  it("lists questions for you and answers one by number", async () => {
    await runCli(["ask", "Ship today?", "--option", "Yes", "--option", "No"], { api: api.url, cwd, home });
    const list = await runCli(["ask", "list"], { api: api.url, cwd, home });
    assert.match(list.stdout, /asks: Ship today\?/);
    const id = api.state.questions[0].id.slice(0, 8);
    assert.equal((await runCli(["ask", "answer", id, "2"], { api: api.url, cwd, home })).code, 0);
    assert.deepEqual(api.state.questions[0].answer, { answer: "no" });
  });

  it("MCP ask_user waits for the answer; ending the session tells the server", async () => {
    api.state.autoAnswer = "yes";
    const mcp = await startMcp({ api: api.url, cwd, home });
    const r = (await mcp.request("tools/call", { name: "networkbase_ask_user", arguments: { question: "Use the new logo?", options: ["Yes", "No"] } })).result;
    assert.equal(r.structuredContent.status, "ok", r.content[0].text);
    assert.equal(r.structuredContent.data.answer.answer, "yes");
    await mcp.close();
    assert.equal(api.state.sessionsEnded, 1);
  });
});
