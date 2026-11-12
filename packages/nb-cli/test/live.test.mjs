import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
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
  /**
   * Runs nb until `until` says so (checked on output and every 100 ms; 15 s at most), stops it, and resolves once it
   * has exited, so a leftover process can't take the next test's events from the shared fake server.
   * @param {string[]} args @param {(out: string) => boolean} until @returns {Promise<string>}
   */
  const runUntil = (args, until) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd, env: { ...cleanEnv(home), NETWORKBASE_API_URL: api.url, NETWORKBASE_TOKEN: "nb_pat_test" } });
    let out = "";
    let stopped = false;
    const done = () => { if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(poll); child.kill("SIGINT"); };
    const timer = setTimeout(done, 15_000);
    const poll = setInterval(() => { if (until(out)) done(); }, 100);
    const check = (/** @type {Buffer} */ d) => { out += d; if (until(out)) done(); };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.on("exit", () => { done(); resolve(out); });
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
    const out = await runUntil(["watch"], () => fs.readFileSync(path.join(cwd, "plan.md"), "utf8") === "v2 from Sam");
    assert.equal(fs.readFileSync(path.join(cwd, "plan.md"), "utf8"), "v2 from Sam", `nb watch said:\n${out}`);
  });
  it("replies and approves from the inbox (C4)", async () => {
    const t = addTask(api.state, { title: "Logo", status: "done", reviewStatus: "pending" });
    const other = addTask(api.state, { title: "Copy", status: "todo" });
    api.state.inbox.unshift(
      { id: "11111111-aaaa-4000-8000-000000000003", title: "Sam asked for your review on Logo", body: null, href: null, readAt: null, activityAt: new Date().toISOString(), entityRefs: { taskId: t.id, projectId: api.state.workspace.id } },
      { id: "11111111-aaaa-4000-8000-000000000004", title: "Sam commented on Copy", body: "ok?", href: null, readAt: null, activityAt: new Date().toISOString(), entityRefs: { taskId: other.id, projectId: api.state.workspace.id, commentId: "22222222-bbbb-4000-8000-000000000001" } },
    );
    const replied = await nb(["inbox", "reply", "2", "fixed", "now"]);
    assert.equal(replied.code, 0, replied.stderr);
    assert.equal(other.comments.at(-1)?.content, "fixed now");
    assert.equal(api.state.inbox[1].readAt !== null, true);
    const approved = await nb(["inbox", "approve", "1"]);
    assert.equal(approved.code, 0, approved.stderr);
    assert.equal(t.reviewStatus, "none");
    const again = await nb(["inbox", "approve", "1"]);
    assert.match(again.stderr, /isn't waiting for review/);
    const plain = await nb(["inbox", "reply", "3", "hi"]);
    assert.match(plain.stderr, /isn't about a task/);
  });
});
