import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Versions only grow on the server (2026-11-11): "Use this version" makes an older version active, so the version
// the CLI sees can go DOWN (v3 → v1). No CLI change is needed: a different version and hash is a server change.
describe("the server goes back to an older version", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  /** The person picks v1 in the app: same file, active version 1 again. */
  const goBackToV1 = () => {
    const cur = /** @type {any} */ (api.state.files.get("/notes.md"));
    api.state.files.set("/notes.md", { ...cur, version: 1, content: Buffer.from("one") });
  };
  beforeEach(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-back-");
    home = await tempDir("nb-back-home-");
    assert.equal((await nb(["init", "design-lab"])).code, 0);
    for (const text of ["one", "two", "three"]) putFile(api.state, "/notes.md", Buffer.from(text));
    assert.equal((await nb(["pull"])).code, 0);
    assert.equal(fs.readFileSync(path.join(cwd, "notes.md"), "utf8"), "three");
  });
  afterEach(() => api.close());

  it("status shows it changed on the server, and pull brings the older version's content", async () => {
    goBackToV1();
    const st = JSON.parse((await nb(["status", "--json"])).stdout).data.files;
    assert.ok(st.some((/** @type {any} */ f) => f.path === "/notes.md" && f.remoteVersion === 1), JSON.stringify(st));
    const r = await nb(["pull"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(cwd, "notes.md"), "utf8"), "one");
    assert.equal((await nb(["status", "--json"])).stdout.includes("/notes.md"), false, "in sync at v1 afterwards");
  });

  it("a local edit started from v3 is a conflict, never an overwrite of what the person chose", async () => {
    fs.writeFileSync(path.join(cwd, "notes.md"), "my edit from v3");
    goBackToV1();
    const r = await nb(["push", "notes.md"]);
    assert.notEqual(r.code, 0, r.stdout);
    assert.equal(api.state.files.get("/notes.md")?.content.toString(), "one", "the server keeps v1");
    assert.equal(fs.readFileSync(path.join(cwd, "notes.md"), "utf8"), "my edit from v3", "the local edit is kept");
  });
});
