import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

describe("nb login --device (report A3.1)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());
  const login = async (/** @type {string[]} */ args, env = {}) => {
    const home = await tempDir("nb-login-home-");
    return { home, r: await runCli(["login", ...args], { api: api.url, home, token: null, env }) };
  };

  it("shows the code, waits through slow_down and pending, then saves the token", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 3, tokenType: "device" });
    const { home, r } = await login(["--device"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /Open .*http:\/\/fake\/device.* and enter .*ABCD-EFGH/);
    assert.equal(api.state.device.polls, 3);
    assert.equal(api.state.device.lastBody.type, "device");
    assert.match(r.stdout, /Signed in as @tester/);
    assert.match(fs.readFileSync(path.join(home, ".networkbase", "credentials.json"), "utf8"), /nb_pat_test0123456789abcdef/);
  });

  it("signing in again sends this computer's sign-in to be renewed; 7 days before it ends, nb says so (C6)", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, polls: 0, tokenType: "device" });
    const home = await tempDir("nb-login-renew-");
    const old = "nb_dev_0123456789abcdef0123456789abcdef";
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    fs.mkdirSync(path.join(home, ".networkbase"), { recursive: true });
    fs.writeFileSync(path.join(home, ".networkbase", "credentials.json"), JSON.stringify({ profiles: { default: { origin: api.url, token: old, storage: "file", expiresAt: soon } } }));
    const who = await runCli(["whoami"], { api: api.url, home, token: null });
    assert.equal(who.code, 0, who.stderr);
    assert.match(who.stderr, /Your sign-in on this computer ends \d+ \w+: nb login renews it/);
    const r = await runCli(["login", "--device"], { api: api.url, home, token: null });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.lastTokenBody.renew, old);
    const saved = JSON.parse(fs.readFileSync(path.join(home, ".networkbase", "credentials.json"), "utf8")).profiles.default;
    assert.equal(saved.expiresAt, "2027-11-06T09:34:59.663Z", "the new end date is kept");
  });

  it("is used without asking over SSH", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "device" });
    const { r } = await login([], { SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /ABCD-EFGH/);
  });

  it("an agent sign-in says what was approved, and whoami repeats the same sentence (report A4)", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const { home, r } = await login(["--device", "--agent", "Claude Code"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.device.lastBody.type, api.state.device.lastBody.agentName], ["agent", "Claude Code"]);
    assert.match(r.stdout, /Claude Code connected · only Design Lab · small changes only · until \d+ \w+/);
    assert.match(r.stdout, /Try it: open Claude Code and ask "what should I do today\?"/);
    assert.match(r.stderr, /Waiting for you to approve in the browser… ABCD-EFGH \(expires \d\d:\d\d\)/);
    const who = await runCli(["whoami"], { api: api.url, home, token: null });
    assert.match(who.stdout, /token +agent · .*only Design Lab/);
    assert.match(who.stdout, /access +Claude Code can work in Design Lab for 30 days/);
  });

  it("--workspace doesn't stop a signed-out login (found signing in an agent against production)", async () => {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "agent" });
    const { r } = await login(["--device", "--agent", "Claude Code", "--workspace", "design-lab"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /Choose design-lab on the approval page/);
    assert.equal(api.state.device.lastBody.requestedWorkspace, undefined);
  });

  it("a denied sign-in says so and saves nothing", async () => {
    Object.assign(api.state.device, { answer: "deny", afterPolls: 1, tokenType: "device" });
    const { home, r } = await login(["--device"]);
    assert.equal(r.code, 130);
    assert.match(r.stderr, /denied in the browser/);
    assert.ok(!fs.existsSync(path.join(home, ".networkbase", "credentials.json")));
  });
});
