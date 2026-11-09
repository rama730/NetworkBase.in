import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { detectMoves, planSync } from "../lib/sync/plan.mjs";

// Report A1.9, A1.16, A1.17, §17.4.1: moves keep history, case clashes never overwrite, crashes leave nothing behind.
describe("sync edges", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-edge-");
    home = await tempDir("nb-edge-home-");
    assert.equal((await nb(["init", "design-lab"])).code, 0);
  });
  afterEach(() => api.close());

  it("a renamed file is renamed on the server, keeping its history", async () => {
    putFile(api.state, "/notes.md", Buffer.from("same words"));
    assert.equal((await nb(["pull"])).code, 0);
    const nodeId = api.state.files.get("/notes.md")?.nodeId;
    fs.renameSync(path.join(cwd, "notes.md"), path.join(cwd, "plan.md"));
    const st = await nb(["status", "--json"]);
    assert.ok(JSON.parse(st.stdout).data.files.some((/** @type {any} */ f) => f.path === "/plan.md" && /moved/.test(f.state)), st.stdout);
    const r = await nb(["push", "--all"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1 moved/);
    assert.deepEqual(api.state.fileOps.map((o) => [o.kind, o.name]), [["rename", "plan.md"]]);
    assert.equal(api.state.files.get("/plan.md")?.nodeId, nodeId);
    assert.equal((await nb(["status", "--json"])).stdout.includes("/notes.md"), false);
  });

  it("--recreate uploads a file deleted on the server that you still have", async () => {
    putFile(api.state, "/keep.md", Buffer.from("mine"));
    await nb(["pull"]);
    api.state.files.delete("/keep.md");
    const r = await nb(["push", "keep.md", "--recreate"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.files.get("/keep.md")?.content.toString(), "mine");
  });

  it("two server files differing only in case: one is pulled, the other skipped with a note", { skip: !["darwin", "win32"].includes(process.platform) && "case-sensitive disk" }, async () => {
    putFile(api.state, "/Report.md", Buffer.from("A"));
    putFile(api.state, "/report.md", Buffer.from("B"));
    const r = await nb(["pull", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout).data;
    assert.equal(data.files.length, 1);
    assert.match(data.skipped[0].reason, /letter case/);
  });

  it("a crash mid-pull leaves temp files that are never pushed, and the next pull adopts what arrived", async () => {
    putFile(api.state, "/a.md", Buffer.from("A"));
    fs.writeFileSync(path.join(cwd, "a.md"), "A");
    fs.writeFileSync(path.join(cwd, "b.md.nbtmp-1a2b3c4d"), "half");
    fs.rmSync(path.join(cwd, ".networkbase", "state.json"), { force: true });
    const r = await nb(["pull", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const push = await nb(["push", "--all", "--json"]);
    assert.equal(JSON.parse(push.stdout).data.files.length, 0, "nothing re-uploaded, temp file ignored");
  });
});

it("detectMoves pairs only unambiguous delete + add with the same content", () => {
  const base = { "/a.md": { nodeId: "n1", baseVersion: 1, baseHash: "h1", size: 1, mtimeMs: 0 }, "/c.md": { nodeId: "n2", baseVersion: 1, baseHash: "h2", size: 1, mtimeMs: 0 } };
  const remote = new Map([["/a.md", { nodeId: "n1", version: 1, hash: "h1", size: 1 }], ["/c.md", { nodeId: "n2", version: 1, hash: "h2", size: 1 }]]);
  const lf = (/** @type {string} */ p, /** @type {string} */ h) => [p, { remote: p, abs: p, size: 1, mtimeMs: 1, hash: h }];
  const items = planSync({ base, remote, local: new Map(/** @type {any} */ ([lf("/b.md", "h1"), lf("/d.md", "h2"), lf("/e.md", "h2")])) });
  assert.deepEqual(items.filter((i) => i.action === "move").map((i) => [i.from, i.path]), [["/a.md", "/b.md"]]);
  assert.ok(items.some((i) => i.path === "/c.md" && i.action === "delete-remote"), "h2 has two candidates: no guess");
  assert.equal(detectMoves([]).length, 0);
});
