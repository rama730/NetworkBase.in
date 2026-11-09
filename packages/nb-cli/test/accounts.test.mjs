import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOKEN, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A3.5, A3.10, A7.7: see and revoke sign-ins, every profile at once, undo one agent session.
describe("tokens, profiles and session undo", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("nb token list marks this sign-in; revoke by id prefix asks first", async () => {
    const list = await runCli(["token", "list", "--json"], { api: api.url, token: TOKEN });
    assert.equal(list.code, 0, list.stderr);
    const { tokens } = JSON.parse(list.stdout).data;
    assert.deepEqual(tokens.map((/** @type {any} */ t) => [t.type, t.current]), [["device", true], ["agent", false]]);
    const human = await runCli(["token", "list"], { api: api.url, token: TOKEN });
    assert.match(human.stdout, /Claude Code on laptop/);
    const r = await runCli(["token", "revoke", "bbbb", "--yes"], { api: api.url, token: TOKEN });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(api.state.revoked.has("bbbb2222-0000-4000-8000-000000000002"));
    const none = await runCli(["token", "revoke", "zzzz", "--yes"], { api: api.url, token: TOKEN });
    assert.match(none.stderr, /No token zzzz/);
  });

  it("nb whoami --all lists every saved profile and which one is signed in", async () => {
    const home = await tempDir("nb-who-all-");
    const dir = path.join(home, ".networkbase");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "credentials.json"), JSON.stringify({ profiles: {
      default: { origin: api.url, token: TOKEN, user: { username: "tester" } },
      work: { origin: api.url, token: null, user: { email: "w@example.com" } },
    } }), { mode: 0o600 });
    const r = await runCli(["whoami", "--all", "--json"], { api: api.url, home, token: null });
    assert.equal(r.code, 0, r.stderr);
    const rows = JSON.parse(r.stdout).data.profiles;
    assert.deepEqual(rows.map((/** @type {any} */ p) => [p.profile, p.signedIn]), [["default", true], ["work", false]]);
  });

  it("nb undo --session reverses only what this agent session did, newest first", async () => {
    const cwd = await tempDir("nb-undo-session-");
    const home = await tempDir("nb-undo-session-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    fs.writeFileSync(path.join(cwd, "mine.txt"), "1");
    fs.writeFileSync(path.join(cwd, "other.txt"), "2");
    const s1 = { NB_AGENT_SESSION: "sess-1" };
    assert.equal((await runCli(["push", "other.txt", "-m", "x"], { api: api.url, cwd, home, env: { NB_AGENT_SESSION: "sess-2" } })).code, 0);
    assert.equal((await runCli(["push", "mine.txt", "-m", "x"], { api: api.url, cwd, home, env: s1 })).code, 0);
    const before = api.state.undone.length;
    const r = await runCli(["undo", "--session", "--json"], { api: api.url, cwd, home, env: s1 });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(api.state.undone.slice(before).map((u) => u.paths), [["/mine.txt"]]);
    const outside = await runCli(["undo", "--session"], { api: api.url, cwd, home });
    assert.match(outside.stderr, /inside an agent session/);
  });
});
