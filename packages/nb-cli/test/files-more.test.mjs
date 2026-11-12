import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C3 (M4b): trash and restore, mkdir and copy, locks, a diff between versions, remembered partial syncs, and
// --dry-run on every write command.
describe("more file commands (C3)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c3-");
    home = await tempDir("nb-c3-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("lists the Trash with days left and restores by path", async () => {
    api.state.trash = [{ nodeId: "dddddddd-0000-4000-8000-000000000001", path: "/old.md", name: "old.md", type: "file", size: 3, deletedAt: new Date().toISOString(), deletedBy: "sam", daysLeft: 27 }];
    const listed = await nb(["file", "trash"]);
    assert.match(listed.stdout, /\/old\.md .*27/);
    assert.match((await nb(["file", "restore", "old.md"])).stdout, /Restored \/old\.md/);
    assert.match((await nb(["file", "trash"])).stdout, /The Trash is empty/);
    assert.equal((await nb(["file", "restore", "gone.md"])).code, 1);
  });

  it("makes a folder and copies a file", async () => {
    assert.match((await nb(["file", "mkdir", "design"])).stdout, /Made \/design\//);
    // A folder made here can be deleted by its path (M4b live check).
    const gone = await nb(["file", "delete", "design", "--yes"]);
    assert.equal(gone.code, 0, gone.stderr);
    assert.deepEqual(api.state.fileOps.at(-1)?.kind, "trash");
    putFile(api.state, "/report.md", Buffer.from("hello"));
    const copied = await nb(["file", "copy", "report.md", "drafts/report-v2.md"]);
    assert.equal(copied.code, 0, copied.stderr);
    assert.equal(api.state.files.get("/drafts/report-v2.md")?.content.toString(), "hello");
  });

  it("diffs two server versions", async () => {
    putFile(api.state, "/notes.md", Buffer.from("one\ntwo\n"));
    putFile(api.state, "/notes.md", Buffer.from("one\nthree\n"));
    const d = await nb(["diff", "notes.md", "--from", "v1", "--to", "v2"]);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /v1 → v2/);
    assert.match(d.stdout, /-two/);
    assert.match(d.stdout, /\+three/);
  });

  it("locks for a while, then lets go", async () => {
    putFile(api.state, "/plan.md", Buffer.from("x"));
    const r = await nb(["file", "lock", "plan.md", "--for", "1s"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /Locked \/plan\.md: teammates see you're editing it for 1s/);
    assert.deepEqual((api.state.locks ?? []).map((l) => l.op), ["lock", "release"]);
  });

  it("--dry-run stops before the first change on any write command", async () => {
    const before = api.state.fileOps.length;
    const r = await nb(["file", "mkdir", "nothing-here", "--dry-run"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Dry run, nothing changed\. Would POST \/api\/v1\/extension\/file-operation/);
    assert.equal(api.state.fileOps.length, before);
    const json = JSON.parse((await nb(["task", "create", "Not really", "--dry-run", "--json"])).stdout);
    assert.equal(json.data.wouldSend.body.title, "Not really");
  });

  it("nb sync --only remembers the folders this copy keeps", async () => {
    putFile(api.state, "/design/a.png", Buffer.from("a"));
    putFile(api.state, "/docs/b.md", Buffer.from("b"));
    const r = await nb(["sync", "--only", "design"]);
    assert.match(r.stderr, /This copy keeps design\/ in sync/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "config.json"), "utf8")).only, ["design"]);
    await nb(["pull"]);
    assert.ok(fs.existsSync(path.join(cwd, "design", "a.png")));
    assert.ok(!fs.existsSync(path.join(cwd, "docs", "b.md")), "only the kept folder comes down");
    await nb(["sync", "--only", "all"]);
    await nb(["pull"]);
    assert.ok(fs.existsSync(path.join(cwd, "docs", "b.md")));
  });
});
