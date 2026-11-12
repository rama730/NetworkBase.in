import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";
import { rank } from "../lib/mcp/tools.mjs";

describe("nb mcp (report A7)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  /** @type {string} */
  let home;
  /** @type {string} */
  let cwd;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-mcp-proj-");
    home = await tempDir("nb-mcp-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    mcp = await startMcp({ api: api.url, cwd, home });
  });
  after(async () => { await mcp.close(); await api.close(); });

  it("negotiates the protocol version and answers ping (findings 6, 122)", async () => {
    const init = await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "networkbase");
    const old = await mcp.request("initialize", { protocolVersion: "1999-01-01" });
    assert.equal(old.result.protocolVersion, "2025-11-25", "unknown version → our newest");
    mcp.notify("notifications/initialized");
    assert.deepEqual((await mcp.request("ping")).result, {});
    assert.equal((await mcp.request("no/such")).error.code, -32601);
  });

  it("lists tools with read-only hints and schemas", async () => {
    const { result } = await mcp.request("tools/list");
    const byName = Object.fromEntries(result.tools.map((/** @type {any} */ t) => [t.name, t]));
    assert.ok(byName.networkbase_task_create && byName.networkbase_doc_update && byName.networkbase_file_push);
    assert.equal(byName.networkbase_task_count.annotations.readOnlyHint, true);
    assert.equal(byName.networkbase_task_done.annotations.destructiveHint, true);
    assert.ok(byName.networkbase_task_done.inputSchema.properties.confirmToken);
    // The server can hold any write for a yes (others' tasks, files as final, "Ask for everything"), so every tool
    // that writes takes the token; task_assign and file_attach didn't (found 2026-11-10).
    const writes = result.tools.filter((/** @type {any} */ t) => !t.annotations.readOnlyHint);
    assert.deepEqual(writes.filter((/** @type {any} */ t) => !t.inputSchema.properties.confirmToken).map((/** @type {any} */ t) => t.name), []);
  });

  it("counts and creates tasks; errors are results with a code (finding 123)", async () => {
    addTask(api.state, { title: "Fix login", status: "in_progress" });
    const count = await mcp.call("networkbase_task_count");
    assert.match(count.content[0].text, /1 open task/);
    const created = await mcp.call("networkbase_task_create", { title: "Update the logo", priority: "high", subtasks: ["Sketch"] });
    assert.equal(created.structuredContent.status, "ok", created.content[0].text);
    assert.ok(api.state.tasks.some((t) => t.title === "Update the logo"));
    const missing = await mcp.call("networkbase_task_context", { task: "44" });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /^[A-Z_]+: /);
  });

  it("finds a task by words, and asks when two match", async () => {
    addTask(api.state, { title: "Login page copy" });
    const one = await mcp.call("networkbase_task_find", { query: "update the logo" });
    assert.equal(one.structuredContent.data.match.title, "Update the logo");
    const two = await mcp.call("networkbase_task_find", { query: "login" });
    assert.equal(two.structuredContent.status, "needs_input");
    assert.equal(two.structuredContent.questions[0].options.length, 2);
  });

  it("finishing a task needs the user's yes, with a token bound to the same call", async () => {
    const t = addTask(api.state, { title: "Ship it", status: "in_progress" });
    const args = { task: String(t.taskNumber), summary: "Done and tested" };
    const first = await mcp.call("networkbase_task_done", args);
    assert.equal(first.structuredContent.status, "needs_confirmation");
    assert.ok(!api.requests.some((q) => q.path === "/api/v1/extension/task-update" && q.body?.taskId === t.id), "nothing changed yet");
    const other = await mcp.call("networkbase_task_done", { ...args, summary: "something else", confirmToken: first.structuredContent.confirmToken });
    assert.equal(other.isError, true, "a token is only good for the call it was issued for");
    const again = await mcp.call("networkbase_task_done", args);
    const done = await mcp.call("networkbase_task_done", { ...args, confirmToken: again.structuredContent.confirmToken });
    assert.equal(done.structuredContent.status, "ok", done.content[0].text);
    assert.equal(api.state.tasks.find((x) => x.id === t.id)?.status, "done");
  });

  it("a yes from one MCP server process is good in the next, once (D24: headless agents)", async () => {
    const t = addTask(api.state, { title: "Headless", status: "in_progress" });
    const args = { task: String(t.taskNumber), summary: "Done in CI" };
    const first = await mcp.call("networkbase_task_done", args);
    const token = first.structuredContent.confirmToken;
    assert.match(token, /^y_[0-9a-z]+_[0-9a-f]{18}_[0-9a-f]{32}$/);
    const next = await startMcp({ api: api.url, cwd, home });
    try {
      const done = await next.call("networkbase_task_done", { ...args, confirmToken: token });
      assert.equal(done.structuredContent.status, "ok", done.content[0].text);
      const replay = await next.call("networkbase_task_done", { ...args, confirmToken: token });
      assert.equal(replay.isError, true, "used once");
    } finally {
      await next.close();
    }
    const forged = await mcp.call("networkbase_task_done", { ...args, confirmToken: token.replace(/.$/, (c) => (c === "0" ? "1" : "0")) });
    assert.equal(forged.isError, true);
  });

  it("pushes files only with a message; untrusted text is marked", async () => {
    fs.writeFileSync(path.join(cwd, "notes.md"), "hello");
    const noMessage = await mcp.call("networkbase_file_push", { paths: ["notes.md"], message: " " });
    assert.equal(noMessage.isError, true);
    const pushed = await mcp.call("networkbase_file_push", { paths: ["notes.md"], message: "First notes" });
    assert.equal(pushed.structuredContent.status, "ok", pushed.content[0].text);
    assert.equal(api.state.files.get("/notes.md")?.content.toString(), "hello");
    const viewed = await mcp.call("networkbase_file_view", { path: "/notes.md" });
    assert.match(viewed.content[0].text, /<untrusted source="networkbase file \/notes.md">\nhello/);
  });

  it("changing the README shows a diff and needs a yes; then it's a new version based on the one read", async () => {
    putFile(api.state, "/README.md", Buffer.from("# Design Lab\n"));
    api.state.docs.push({ slug: "readme", filename: "README.md", nodePath: "/README.md" });
    const first = await mcp.call("networkbase_doc_update", { content: "# Design Lab\n\nInstall: npm i\n" });
    assert.equal(first.structuredContent.status, "needs_confirmation", first.content[0].text);
    assert.match(first.structuredContent.preview ?? "", /\+Install: npm i/);
    const saved = await mcp.call("networkbase_doc_update", { content: "# Design Lab\n\nInstall: npm i\n", confirmToken: first.structuredContent.confirmToken });
    assert.equal(saved.structuredContent.status, "ok", saved.content[0].text);
    const placed = api.requests.filter((q) => q.path === "/api/v1/files/place").at(-1);
    assert.ok(placed?.body.files[0].versionOf && placed.body.files[0].baseVersion, "versionOf + baseVersion sent");
  });

  it("reads a task as a resource and sends progress when asked (A7.2 item 4)", async () => {
    const t = addTask(api.state, { title: "Resource task", description: "Brief here" });
    const templates = await mcp.request("resources/templates/list");
    assert.equal(templates.result.resourceTemplates[0].uriTemplate, "networkbase://task/{number}");
    const read = await mcp.request("resources/read", { uri: `networkbase://task/${t.taskNumber}` });
    assert.match(read.result.contents[0].text, /Resource task/);
    fs.writeFileSync(path.join(cwd, "p1.md"), "a");
    fs.writeFileSync(path.join(cwd, "p2.md"), "b");
    const before = mcp.lines.length;
    const pushed = await mcp.request("tools/call", { name: "networkbase_file_push", arguments: { paths: ["p1.md", "p2.md"], message: "two" }, _meta: { progressToken: "pt-1" } });
    assert.equal(pushed.result.structuredContent.status, "ok", pushed.result.content[0].text);
    const progress = mcp.lines.slice(before).map((l) => JSON.parse(l)).filter((m) => m.method === "notifications/progress");
    assert.ok(progress.length >= 1, "at least one progress notification");
    assert.equal(progress[0].params.progressToken, "pt-1");
  });

  it("stdout carried nothing but JSON-RPC (finding 5)", async () => {
    mcp.raw("{not json");
    await mcp.request("ping");
    for (const line of mcp.lines) assert.equal(JSON.parse(line).jsonrpc, "2.0", line);
  });
});

describe("nb mcp with an agent sign-in (report A6)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-mcp-agent-");
    home = await tempDir("nb-mcp-agent-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(async () => { await api.close(); });

  it("starts with the access card: who, where, what alone, what waits, and asking for more", async () => {
    api.state.agentAccess = { agentName: "Claude Code", preset: "small", sentence: "Claude Code can work in Design Lab for 30 days. It does small things itself and can't finish tasks, change final files or edit docs.", workspaceId: null, workspaceTitle: "Design Lab", allWorkspaces: false, expiresAt: "2026-12-11T00:00:00.000Z" };
    const mcp = await startMcp({ api: api.url, cwd, home, token: "nb_agt_0123456789abcdef0123" });
    try {
      const { instructions } = (await mcp.request("initialize", { protocolVersion: "2025-06-18" })).result;
      assert.match(instructions, /^You are working for Test User \(@tester\) on NetworkBase\./);
      assert.match(instructions, /What they approved: "Claude Code can work in Design Lab for 30 days\./);
      assert.match(instructions, /access_requested/);
      const done = await mcp.call("networkbase_task_done", { task: String(addTask(api.state, { title: "Ship it", status: "in_progress" }).taskNumber) });
      assert.equal(done.structuredContent.status, "access_requested");
      assert.equal(done.structuredContent.scope, "task:complete");
      assert.match(done.content[0].text, /^access_requested: .*finish tasks.*asked the person in NetworkBase/s);
      assert.match(done.content[0].text, /Don't look for another way/);
      const { tools } = (await mcp.request("tools/list")).result;
      assert.match(tools.find((/** @type {any} */ t) => t.name === "networkbase_task_done").description, /^Asks the person first:/);
    } finally { await mcp.close(); }
  });

  it("Read only lists only the tools that read", async () => {
    api.state.agentAccess = { agentName: "Claude Code", preset: "read", sentence: "Claude Code can read Design Lab for 30 days. It can't change anything.", workspaceId: null, workspaceTitle: "Design Lab", allWorkspaces: false, expiresAt: "2026-12-11T00:00:00.000Z" };
    const mcp = await startMcp({ api: api.url, cwd, home, token: "nb_agt_0123456789abcdef0123" });
    try {
      await mcp.request("initialize", { protocolVersion: "2025-06-18" });
      const { tools } = (await mcp.request("tools/list")).result;
      assert.deepEqual(tools.filter((/** @type {any} */ t) => !t.annotations.readOnlyHint).map((/** @type {any} */ t) => t.name), []);
      assert.ok(tools.some((/** @type {any} */ t) => t.name === "networkbase_task_list"));
    } finally { await mcp.close(); }
  });

  it("a person's own sign-in keeps every tool and says whose it is", async () => {
    const mcp = await startMcp({ api: api.url, cwd, home });
    try {
      const { instructions } = (await mcp.request("initialize", { protocolVersion: "2025-06-18" })).result;
      assert.match(instructions, /^Signed in as Test User \(@tester\) with their own sign-in/);
      const { tools } = (await mcp.request("tools/list")).result;
      assert.ok(tools.some((/** @type {any} */ t) => t.name === "networkbase_doc_update"));
    } finally { await mcp.close(); }
  });
});

it("rank: exact number first, then title start, then all words", () => {
  const tasks = [{ n: "4", t: "Fix login" }, { n: "7", t: "Login page copy" }, { n: "9", t: "Logo" }];
  const r = rank(tasks, "4", (x) => [x.n], (x) => x.t);
  assert.equal(r[0]?.item.n, "4");
  assert.equal(rank(tasks, "login page", (x) => [x.n], (x) => x.t)[0]?.item.n, "7");
});
