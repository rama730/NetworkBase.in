import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { CLI_PATH, cleanEnv, runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A11.1–A11.2, A1.13 item 5: the inbox, waiting for new items, and nb watch pulling a teammate's version.
describe("inbox and live changes", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  /** Runs nb until `until` says so (or 10 s), then stops it. @param {string[]} args @param {(out: string) => boolean} until */
  const runUntil = (args, until) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd, env: { ...cleanEnv(home), NETWORKBASE_API_URL: api.url, NETWORKBASE_TOKEN: "nb_pat_test" } });
    let out = "";
    const done = () => { clearTimeout(timer); child.kill("SIGINT"); resolve(out); };
    const timer = setTimeout(done, 10_000);
    const check = (/** @type {Buffer} */ d) => { out += d; if (until(out)) done(); };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
  });
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-live-");
    home = await tempDir("nb-live-home-");
    await nb(["init", "design-lab"]);
    api.state.inbox.push(
      { id: "11111111-aaaa-4000-8000-000000000001", title: "Sam commented on Logo", body: "Looks good", href: "/workspaces/design-lab?tab=tasks&task=1", readAt: null, activityAt: new Date().toISOString() },
      { id: "11111111-aaaa-4000-8000-000000000002", title: "Review requested", body: null, href: null, readAt: new Date().toISOString(), activityAt: new Date().toISOString() },
    );
  });
  after(() => api.close());

  it("lists the inbox, filters unread, and marks read", async () => {
    const all = await nb(["inbox", "--json"]);
    assert.equal(JSON.parse(all.stdout).data.items.length, 2);
    const unread = await nb(["inbox", "--unread"]);
    assert.match(unread.stdout, /1 unread/);
    assert.match(unread.stdout, /Sam commented on Logo/);
    assert.doesNotMatch(unread.stdout, /Review requested/);
    assert.equal((await nb(["inbox", "read", "1"])).code, 0);
    assert.ok(api.state.inbox[0].readAt);
  });

  it("--follow prints new items as they arrive (NDJSON with --json)", async () => {
    api.state.events.push({ notifications: [{ id: "n1", kind: "task_assigned", title: "You were assigned #7", body: null, href: null, importance: "important", at: new Date().toISOString() }], files: [] });
    const out = await runUntil(["inbox", "--follow", "--json"], (o) => o.includes("nb.inbox.item/1"));
    const line = String(out).split("\n").find((/** @type {string} */ l) => l.includes("nb.inbox.item/1")) ?? "";
    assert.equal(JSON.parse(line).data.title, "You were assigned #7");
  });

  it("nb watch pulls a teammate's new version of a file", async () => {
    putFile(api.state, "/plan.md", Buffer.from("v1"));
    await nb(["pull"]);
    const { file } = putFile(api.state, "/plan.md", Buffer.from("v2 from Sam"));
    api.state.events.push({ notifications: [], files: [{ path: "/plan.md", nodeId: file.nodeId, version: file.version, at: new Date().toISOString(), by: "sam", mine: false }] });
    await runUntil(["watch"], () => fs.readFileSync(path.join(cwd, "plan.md"), "utf8") === "v2 from Sam");
    assert.equal(fs.readFileSync(path.join(cwd, "plan.md"), "utf8"), "v2 from Sam");
  });
});
