import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report H6 (M8, phase H-2): the folder is on one branch and you always know which. nb branch create and switch move
// it like git; it follows git's branch by itself; push and pull use the branch, never main by accident.
describe("nb branch: create, switch, push and pull on a branch, follow git", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args, extra = {}) => runCli(args, { api: api.url, cwd, home, ...extra });
  const write = (/** @type {string} */ rel, /** @type {string} */ text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
  const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(cwd, rel), "utf8");
  const config = () => JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "config.json"), "utf8"));
  const branch = (/** @type {string} */ name) => /** @type {any} */ (api.state).branches.find((/** @type {any} */ b) => b.name === name);
  const git = (/** @type {string} */ head) => { fs.mkdirSync(path.join(cwd, ".git"), { recursive: true }); fs.writeFileSync(path.join(cwd, ".git", "HEAD"), `${head}\n`); };

  beforeEach(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).branchesOn = true;
    putFile(api.state, "/README.md", Buffer.from("# Main\n"));
    putFile(api.state, "/src/app.ts", Buffer.from("main app\n"));
    cwd = await tempDir("nb-branch-");
    home = await tempDir("nb-home-");
    assert.equal((await nb(["init", "design-lab"])).code, 0);
    assert.equal((await nb(["pull", "--yes"])).code, 0);
  });
  afterEach(() => api.close());

  it("create moves the folder onto the branch; a push saves there and main is unchanged", async () => {
    const made = await nb(["branch", "create", "feature-x"]);
    assert.equal(made.code, 0, made.stderr);
    assert.equal(config().branch.name, "feature-x");
    write("src/app.ts", "branch app\n");
    write("docs/new.md", "new\n");
    const pushed = await nb(["push", "src/app.ts", "docs/new.md", "--yes"]);
    assert.equal(pushed.code, 0, pushed.stderr);
    assert.match(pushed.stdout, /on feature-x/);
    assert.equal(branch("feature-x").files.get("/src/app.ts").content.toString(), "branch app\n");
    assert.equal(api.state.files.get("/src/app.ts")?.content.toString(), "main app\n", "main is untouched");
    assert.ok(!api.state.files.has("/docs/new.md"));
    const status = await nb(["status", "--json"]);
    const d = JSON.parse(status.stdout).data;
    assert.equal(d.branch, "feature-x");
    assert.deepEqual(d.files, [], "the folder's base is the branch's files");
    assert.ok(fs.existsSync(path.join(cwd, ".networkbase", `state.${branch("feature-x").id}.json`)));
  });

  it("switch replaces files that differ, sets aside ones the other branch lacks, and stops on an edit that would mix", async () => {
    await nb(["branch", "create", "feature-x"]);
    write("src/app.ts", "branch app\n");
    write("docs/new.md", "new\n");
    await nb(["push", "src/app.ts", "docs/new.md", "--yes"]);
    const back = await nb(["branch", "switch", "main"]);
    assert.equal(back.code, 0, back.stderr);
    assert.equal(read("src/app.ts"), "main app\n");
    assert.ok(!fs.existsSync(path.join(cwd, "docs/new.md")), "set aside, not on main");
    assert.equal(config().branch, null);
    // An edit to a file that's different on the other branch stops the switch, unless --carry.
    write("src/app.ts", "edited on main\n");
    const stop = await nb(["branch", "switch", "feature-x"]);
    assert.equal(stop.code !== 0, true);
    assert.match(stop.stderr, /different on feature-x/);
    // An edit to a file that's the same on both comes along.
    write("src/app.ts", "main app\n");
    write("README.md", "# Main, edited\n");
    const go = await nb(["branch", "switch", "feature-x"]);
    assert.equal(go.code, 0, go.stderr);
    assert.equal(read("README.md"), "# Main, edited\n", "kept");
    assert.equal(read("src/app.ts"), "branch app\n");
    const status = JSON.parse((await nb(["status", "--json"])).stdout).data;
    assert.deepEqual(status.files.map((/** @type {any} */ f) => [f.path, f.state]), [["/README.md", "modified"]]);
  });

  it("follows git: a git branch with the same name switches; an unknown one asks; main follows main", async () => {
    await nb(["branch", "create", "feature-x", "--no-switch"]);
    branch("feature-x").files.set("/src/app.ts", { ...branch("feature-x").files.get("/src/app.ts"), content: Buffer.from("branch app\n"), version: 9 });
    git("ref: refs/heads/feature-x");
    const s1 = await nb(["status"]);
    assert.equal(s1.code, 0, s1.stderr);
    assert.match(s1.stdout, /on branch feature-x/);
    assert.equal(read("src/app.ts"), "branch app\n");
    // An unknown git branch: --json gets NEEDS_INPUT, never a guess; --yes creates it.
    git("ref: refs/heads/spike");
    const asked = await nb(["status", "--json"]);
    assert.equal(asked.code, 6, asked.stderr);
    assert.match(asked.stdout + asked.stderr, /Create NetworkBase branch spike/);
    const yes = await nb(["status", "--yes"]);
    assert.equal(yes.code, 0, yes.stderr);
    assert.equal(config().branch.name, "spike");
    git("ref: refs/heads/master");
    await nb(["status"]);
    assert.equal(config().branch, null, "master follows main");
  });

  it("on a branch folder, nb file delete/move/rename refuse: they would change main (live check, 2026-11-17)", async () => {
    await nb(["branch", "create", "feature-x"]);
    const r = await nb(["file", "delete", "README.md", "--yes"]);
    assert.equal(r.code, 4, r.stderr);
    assert.match(r.stderr, /on branch feature-x; nb file delete changes main/);
    assert.ok(api.state.files.has("/README.md"), "main untouched");
    git("ref: refs/heads/main");
    const ok = await nb(["file", "delete", "README.md", "--yes"]);
    assert.equal(ok.code, 0, ok.stderr);
  });

  it("branch list and update follow git too, before any sync command (live check, 2026-11-17)", async () => {
    await nb(["branch", "create", "feature-x", "--no-switch"]);
    git("ref: refs/heads/feature-x");
    const list = JSON.parse((await nb(["branch", "list", "--json"])).stdout).data;
    assert.equal(list.current, branch("feature-x").id);
    git("ref: refs/heads/main");
    assert.equal((await nb(["branch", "list"])).code, 0);
    git("ref: refs/heads/feature-x");
    const up = await nb(["branch", "update"]);
    assert.equal(up.code, 0, up.stderr);
    assert.equal(/** @type {any} */ (api.state).updates.at(-1).branch, branch("feature-x").id);
  });

  it("a detached git head can't push; workspaces without branches leave git alone", async () => {
    git("8c3f2a9e1b7d4c6a5f0e9d8c7b6a5f4e3d2c1b0a");
    write("README.md", "x\n");
    const r = await nb(["push", "README.md", "--yes"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /detached HEAD/);
    /** @type {any} */ (api.state).branchesOff = true;
    git("ref: refs/heads/anything");
    const s = await nb(["status"]);
    assert.equal(s.code, 0, s.stderr);
    assert.equal(config().branch, null);
  });

  it("list marks this folder's branch; update sends choices and reports conflicts with exit 4", async () => {
    await nb(["branch", "create", "feature-x"]);
    const list = JSON.parse((await nb(["branch", "list", "--json"])).stdout).data;
    assert.equal(list.current, branch("feature-x").id);
    assert.deepEqual(list.branches.map((/** @type {any} */ b) => b.name), ["main", "feature-x"]);
    /** @type {any} */ (api.state).updateAnswer = { upToDate: false, save: null, conflicts: [{ path: "/README.md", kind: "edit" }] };
    const held = await nb(["branch", "update"]);
    assert.equal(held.code, 4, held.stderr);
    assert.match(held.stdout, /--keep-branch/);
    /** @type {any} */ (api.state).updateAnswer = null;
    const done = await nb(["branch", "update", "--keep-branch", "README.md", "--take-main", "src/app.ts"]);
    assert.equal(done.code, 0, done.stderr);
    assert.deepEqual(/** @type {any} */ (api.state).updates.at(-1).resolutions, { "/README.md": "branch", "/src/app.ts": "main" });
    const del = await nb(["branch", "delete", "feature-x", "--yes"]);
    assert.notEqual(del.code, 0, "not the branch this folder is on");
  });
});
