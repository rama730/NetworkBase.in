import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A4 (start, approved, afterwards), A5 (what the CLI asks for), A6 #1 (the instructions block), A10.
describe("agent access in the terminal", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("the sign-in asks for what the flags say; the page starts there", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const home = await tempDir("nb-access-home-");
    const r = await runCli(["login", "--device", "--agent", "Claude Code", "--access", "read", "--all-workspaces"], { api: api.url, home, token: null });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.device.lastBody.requestedAccess, "read");
    assert.equal(api.state.device.lastBody.requestedWorkspace, "all");
    const bad = await runCli(["login", "--device", "--agent", "Claude Code", "--access", "everything"], { api: api.url, home: await tempDir("nb-access-home-"), token: null });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /--access takes full, small or read/);
  });

  it("a linked folder's slug becomes its workspace id before signing in", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const home = await tempDir("nb-access-home-");
    const cwd = await tempDir("nb-access-proj-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["login", "--device", "--agent", "Claude Code", "--workspace", "design-lab"], { api: api.url, cwd, home, token: null });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.device.lastBody.requestedWorkspace, api.state.workspace.id);
  });

  it("no QR code and no browser outside a terminal", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const r = await runCli(["login", "--device", "--agent", "Claude Code"], { api: api.url, home: await tempDir("nb-access-home-"), token: null });
    assert.doesNotMatch(r.stderr, /[█▀▄]/);
    assert.doesNotMatch(r.stderr, /Opened your browser/);
  });

  it("nb agent status lists each signed-in agent with its sentence", async () => {
    const home = await tempDir("nb-access-home-");
    const cwd = await tempDir("nb-access-proj-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["agent", "status"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Claude Code on laptop\n +Claude Code can work in Design Lab for 30 days/);
  });

  it("nb agent access opens the agent's Settings page, pre-filled", async () => {
    const home = await tempDir("nb-access-home-");
    const r = await runCli(["agent", "access", "claude", "--read-only", "--all-workspaces", "--json"], { api: api.url, home });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout).data;
    assert.equal(out.url, `${api.url}/settings/agents/bbbb2222-0000-4000-8000-000000000002?access=read&workspace=all`);
    assert.equal(out.opened, false);
    const none = await runCli(["agent", "access", "codex"], { api: api.url, home });
    assert.equal(none.code, 1);
    assert.match(none.stderr, /No Codex sign-in yet/);
    const both = await runCli(["agent", "access", "claude", "--full", "--small"], { api: api.url, home });
    assert.equal(both.code, 2);
  });

  it("the instructions block points the agent to the access card", async () => {
    const home = await tempDir("nb-access-home-");
    const cwd = await tempDir("nb-access-proj-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["agent", "setup", "claude", "--token", "mine", "--yes"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /instructions start with an access card/);
  });
});
