import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D1, D13, D21 (M4c): the agent starts knowing who, where and what's next; one tool answers "what changed
// since yesterday"; prompts and resources for weeks, hand-ins and classes.
describe("session start, briefing, prompts (D1, D13, D21)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  before(async () => {
    api = await startFakeServer();
    const cwd = await tempDir("nb-start-");
    const home = await tempDir("nb-start-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    addTask(api.state, { title: "Fix login", status: "in_progress" });
    api.state.inbox.push({ id: "n1", title: "Sam commented on #1", body: "looks good", createdAt: new Date().toISOString(), readAt: null });
    mcp = await startMcp({ api: api.url, cwd, home });
  });
  after(async () => { await mcp.close(); await api.close(); });

  it("the instructions say who, which workspace, what's next and what's waiting, in under 400 tokens", async () => {
    const { instructions } = (await mcp.request("initialize", { protocolVersion: "2025-06-18" })).result;
    assert.match(instructions, /This folder is linked to Design Lab \(design-lab\)/);
    assert.match(instructions, /#1 Fix login/);
    assert.match(instructions, /1 unread in their inbox/);
    assert.ok(instructions.length / 4 < 400, `${Math.ceil(instructions.length / 4)} tokens`);
  });

  it("networkbase_briefing answers what changed since a time, what's waiting and what's next, in one call", async () => {
    const r = await mcp.call("networkbase_briefing", { since: "1d" });
    assert.equal(r.structuredContent.status, "ok", r.content[0].text);
    assert.match(r.content[0].text, /Next up/);
    assert.match(r.content[0].text, /Inbox: 1 unread/);
    assert.match(r.content[0].text, /Sam commented on #1/);
    assert.match(r.content[0].text, /Changes since/);
  });

  it("new prompts and resources: plan my week, check my hand-in, review my class; the workspace overview", async () => {
    const prompts = (await mcp.request("prompts/list")).result.prompts.map((/** @type {any} */ p) => p.name);
    for (const p of ["plan-week", "check-hand-in", "review-class"]) assert.ok(prompts.includes(p), p);
    const hand = (await mcp.request("prompts/get", { name: "check-hand-in", arguments: { assignment: "3" } })).result.messages[0].content.text;
    assert.match(hand, /AI policy/);
    const resources = (await mcp.request("resources/list")).result.resources.map((/** @type {any} */ r) => r.uri);
    assert.ok(resources.includes("networkbase://workspace/overview"));
    const overview = (await mcp.request("resources/read", { uri: "networkbase://workspace/overview" })).result.contents[0].text;
    assert.match(overview, /Design Lab/);
  });
});
