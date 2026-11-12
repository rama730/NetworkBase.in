import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A1: nothing a person or a teammate wrote is lost or silently replaced.
describe("files: init, push, pull, conflicts", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args, extra = {}) => runCli(args, { api: api.url, cwd, home, ...extra });
  const write = (/** @type {string} */ rel, /** @type {string} */ text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
  const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(cwd, rel), "utf8");
  const remote = (/** @type {string} */ p) => api.state.files.get(p);

  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-proj-");
    home = await tempDir("nb-home-");
    const r = await nb(["init", "design-lab"]);
    assert.equal(r.code, 0, r.stderr);
  });
  afterEach(() => api.close());

  it("init links the folder and keeps sync records out of git", () => {
    const config = JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "config.json"), "utf8"));
    assert.equal(config.slug, "design-lab");
    assert.equal(fs.readFileSync(path.join(cwd, ".networkbase", ".gitignore"), "utf8"), "*\n");
    assert.equal(config.apiUrl, undefined, "no server address in the project file");
  });

  it("init refuses an unknown workspace and lists yours", async () => {
    const other = await tempDir("nb-proj2-");
    const r = await runCli(["init", "nope"], { api: api.url, cwd: other, home });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /No workspace nope/);
    assert.match(r.stderr, /design-lab/);
  });

  it("push without paths is refused when not interactive (finding 21)", async () => {
    write("a.txt", "hello");
    const r = await nb(["push"]);
    assert.equal(r.code, 2);
    assert.equal(api.state.files.size, 0, "nothing uploaded");
  });

  it("1.x push --done still uploads but no longer changes status, and says so (P2.9)", async () => {
    write("a.txt", "hello");
    const r = await nb(["push", "a.txt", "--done"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(remote("/a.txt")?.version, 1);
    assert.match(r.stderr, /--done no longer changes the task's status/);
    assert.ok(!api.requests.some((q) => q.path === "/api/v1/extension/task-update"), "no status change");
    assert.ok(!(await nb(["help", "push"])).stdout.includes("--done"), "hidden from help");
  });

  it("push uploads named files; a second push makes a new version based on the first", async () => {
    write("notes/plan.md", "v1");
    assert.equal((await nb(["push", "notes/plan.md"])).code, 0);
    assert.equal(remote("/notes/plan.md")?.version, 1);
    write("notes/plan.md", "v2 here");
    const r = await nb(["push", "notes/plan.md", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.files[0].version, 2);
    const placed = api.requests.filter((q) => q.path === "/api/v1/files/place").at(-1);
    assert.equal(placed?.body.files[0].baseVersion, 1, "sends the version it started from");
    assert.ok(placed?.headers["idempotency-key"], "every write carries an idempotency key");
  });

  it("changed here and on the server → push refuses, pull keeps both, resolve settles it", async () => {
    write("report.md", "base");
    await nb(["push", "report.md"]);
    write("report.md", "my edit");
    putFile(api.state, "/report.md", Buffer.from("teammate edit"));

    const pushed = await nb(["push", "report.md"]);
    assert.equal(pushed.code, 4, pushed.stderr);
    assert.equal(remote("/report.md")?.content.toString(), "teammate edit", "the teammate's version stays");

    const pulled = await nb(["pull"]);
    assert.equal(pulled.code, 4);
    assert.equal(read("report.md"), "my edit", "your file is untouched");
    assert.equal(read("report.remote-v2.md"), "teammate edit", "theirs is saved next to it");

    const status = await nb(["status", "--json"]);
    assert.equal(status.code, 4);
    assert.equal(JSON.parse(status.stdout).data.files.find((/** @type {any} */ f) => f.path === "/report.md").state, "conflict");

    const resolved = await nb(["resolve", "report.md", "--both"]);
    assert.equal(resolved.code, 0, resolved.stderr);
    assert.equal(read("report.md"), "teammate edit");
    assert.equal(read("report (2).md"), "my edit");
    assert.equal(remote("/report (2).md")?.content.toString(), "my edit");
    assert.ok(!fs.existsSync(path.join(cwd, "report.remote-v2.md")), "the conflict copy is cleaned up");
  });

  it("resolve --mine replaces the server's version; --theirs takes it", async () => {
    write("a.md", "base");
    await nb(["push", "a.md"]);
    write("a.md", "mine");
    putFile(api.state, "/a.md", Buffer.from("theirs"));
    assert.equal((await nb(["resolve", "a.md", "--mine"])).code, 0);
    assert.equal(remote("/a.md")?.content.toString(), "mine");

    write("b.md", "base");
    await nb(["push", "b.md"]);
    write("b.md", "mine");
    putFile(api.state, "/b.md", Buffer.from("theirs"));
    assert.equal((await nb(["resolve", "b.md", "--theirs"])).code, 0);
    assert.equal(read("b.md"), "theirs");
  });

  it("pull brings new and changed files, and moves files deleted on the server to a local trash", async () => {
    putFile(api.state, "/docs/new.md", Buffer.from("new"));
    write("old.md", "old");
    await nb(["push", "old.md"]);
    api.state.files.delete("/old.md");
    const r = await nb(["pull", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(read("docs/new.md"), "new");
    assert.ok(!fs.existsSync(path.join(cwd, "old.md")));
    const trash = fs.readdirSync(path.join(cwd, ".networkbase", "trash"));
    assert.equal(trash.length, 1, "kept, not deleted");
  });

  it("offline push is queued (exit 8) and the next sync sends it once (A12.4)", async () => {
    write("a.txt", "v1");
    await nb(["push", "a.txt"]);
    write("a.txt", "v2 offline");
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, "drop");
    const queued = await nb(["push", "a.txt"]);
    assert.equal(queued.code, 8, queued.stderr);
    assert.match(queued.stderr, /queued this push/);
    assert.match((await nb(["status"])).stdout, /1 push\(es\) queued while offline: nb queue/);
    // C6: the queue is visible, and nb queue retry sends it.
    const listed = await nb(["queue"]);
    assert.match(listed.stdout, /1 push is waiting to send/);
    assert.match(listed.stdout, /1\. a\.txt .*queued .*: the server couldn't be reached/);
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, null);
    const synced = await nb(["queue", "retry"]);
    assert.match(synced.stdout, /Sent 1 queued push/);
    assert.equal(synced.code, 0, synced.stderr);
    assert.equal(remote("/a.txt")?.content.toString(), "v2 offline");
    assert.equal(remote("/a.txt")?.version, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "queue.json"), "utf8")).entries, []);
  });

  it("nb queue drop forgets a queued push and leaves the file alone (C6)", async () => {
    write("b.txt", "v1");
    await nb(["push", "b.txt"]);
    write("b.txt", "v2 offline");
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, "drop");
    assert.equal((await nb(["push", "b.txt"])).code, 8);
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, null);
    const dropped = await nb(["queue", "drop", "1"]);
    assert.equal(dropped.code, 0, dropped.stderr);
    assert.match((await nb(["queue"])).stdout, /Nothing waiting/);
    assert.equal(read("b.txt"), "v2 offline");
    assert.equal(remote("/b.txt")?.version, 1);
    assert.equal((await nb(["queue", "drop"])).code, 2);
  });

  it("a queued push whose file changed on the server meanwhile becomes a conflict, not an overwrite", async () => {
    write("a.txt", "v1");
    await nb(["push", "a.txt"]);
    write("a.txt", "mine");
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, "drop");
    assert.equal((await nb(["push", "a.txt"])).code, 8);
    api.setFault(`/api/v1/workspaces/${WORKSPACE_ID}/manifest`, null);
    putFile(api.state, "/a.txt", Buffer.from("teammate"));
    const r = await nb(["sync"]);
    assert.equal(r.code, 4, r.stderr);
    assert.equal(remote("/a.txt")?.content.toString(), "teammate");
    assert.equal(read("a.txt"), "mine");
  });

  it("ignored files never upload, even with --all", async () => {
    write(".gitignore", "build/\n*.log\n");
    write("build/out.js", "x");
    write("debug.log", "x");
    write("src/app.js", "app");
    await nb(["push", "src/app.js", ".gitignore"]);
    write("src/app.js", "app v2");
    const r = await nb(["push", "--all"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!remote("/build/out.js") && !remote("/debug.log"));
    assert.equal(remote("/src/app.js")?.version, 2);
  });

  it("a file that looks like it holds a token is refused (exit 5) until confirmed", async () => {
    write("config.ts", "const t = 'nb_pat_0123456789abcdef0123';");
    const r = await nb(["push", "config.ts"]);
    assert.equal(r.code, 5);
    assert.match(r.stderr, /NetworkBase token/);
    assert.equal((await nb(["push", "config.ts", "--confirm-secrets"])).code, 0);
  });

  it("diff shows changes against the last-pulled version, offline", async () => {
    write("plan.md", "one\ntwo\nthree\n");
    await nb(["push", "plan.md"]);
    write("plan.md", "one\nTWO\nthree\n");
    const r = await nb(["diff", "--plain"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /-two/);
    assert.match(r.stdout, /\+TWO/);
  });

  it("dry-run changes nothing", async () => {
    write("a.txt", "a");
    const r = await nb(["push", "a.txt", "--dry-run"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /would push/);
    assert.equal(api.state.files.size, 0);
  });

  it("a read-only member can't push", async () => {
    api.state.canWrite = false;
    write("a.txt", "a");
    const r = await nb(["push", "a.txt"]);
    assert.equal(r.code, 5);
    assert.match(r.stderr, /read this workspace but not change it/);
  });

  it("works from a subfolder, like git", async () => {
    write("src/deep/x.md", "x");
    const r = await runCli(["push", "x.md"], { api: api.url, cwd: path.join(cwd, "src", "deep"), home });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(remote("/src/deep/x.md"));
  });

  it("refuses a server path that would land outside the folder (finding 34)", async () => {
    putFile(api.state, "/../escape.txt", Buffer.from("x"));
    const r = await nb(["pull"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /outside this folder|unsafe/i);
    assert.ok(!fs.existsSync(path.join(cwd, "..", "escape.txt")));
  });
});
