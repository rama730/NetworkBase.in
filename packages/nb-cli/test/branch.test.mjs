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

  it("a protected main (H5): push asks, then goes to a new branch with a merge request; in git it says how; --json needs the yes", async () => {
    /** @type {any} */ (api.state).protection = { requireMergeRequest: true, agentsOnBranches: true };
    write("src/app.ts", "edited\n");
    const refused = await nb(["push", "src/app.ts", "--json"]);
    assert.notEqual(refused.code, 0, "no yes, no push");
    assert.equal(api.state.files.get("/src/app.ts")?.content.toString(), "main app\n");
    const pushed = await nb(["push", "src/app.ts", "--yes", "--message", "Fix the app"]);
    assert.equal(pushed.code, 0, pushed.stderr);
    const made = /** @type {any} */ (api.state).branches.find((/** @type {any} */ b) => b.name.endsWith(new Date().toISOString().slice(0, 10)));
    assert.ok(made, "a branch named for you and today");
    assert.equal(config().branch.name, made.name, "the folder is on it");
    assert.equal(made.files.get("/src/app.ts").content.toString(), "edited\n");
    assert.equal(api.state.files.get("/src/app.ts")?.content.toString(), "main app\n", "main is untouched");
    assert.match(pushed.stderr + pushed.stdout, /Opened merge request !1/);
    assert.equal(/** @type {any} */ (api.state).mergeRequests?.[0]?.title ?? "Fix the app", "Fix the app");
    // In a git folder NetworkBase follows git: the fix is a git branch.
    await nb(["branch", "switch", "main", "--carry"]);
    git("ref: refs/heads/main");
    write("src/app.ts", "again\n");
    const inGit = await nb(["push", "src/app.ts", "--yes"]);
    assert.notEqual(inGit.code, 0);
    assert.match(inGit.stderr, /git switch -c/);
  });

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

  // M9 B2 (C14b, H6, H24): a branch folder's file history, use and diff are the branch's; nb init --branch; a folder
  // whose branch was deleted says so, and switching to main keeps its edits.
  it("on a branch folder, file history lists the branch's saves, file use makes a save there, diff --from compares saves", async () => {
    await nb(["branch", "create", "feature-x"]);
    const b = branch("feature-x");
    b.saves = [{ id: "s2", number: 2, kind: "save", message: "Second try", author: { username: "ram" }, via: null, createdAt: "2026-11-18T09:00:00Z", paths: ["/src/app.ts"] }, { id: "s1", number: 1, kind: "save", message: "First try", author: { username: "ram" }, via: null, createdAt: "2026-11-18T08:00:00Z", paths: ["/src/app.ts"] }];
    b.saveFiles = new Map([["1:/src/app.ts", Buffer.from("first\n")], ["2:/src/app.ts", Buffer.from("second\n")]]);
    const history = await nb(["file", "history", "src/app.ts"]);
    assert.equal(history.code, 0, history.stderr);
    assert.match(history.stdout, /save 2 .*Second try/);
    assert.match(history.stdout, /nb file use src\/app\.ts <save>/);
    const listed = api.requests.findLast((r) => r.path.endsWith("/saves"));
    assert.equal(listed?.query.get("branch"), b.id);
    assert.equal(listed?.query.get("path"), "/src/app.ts");
    const diff = await nb(["diff", "src/app.ts", "--from", "1", "--to", "2"]);
    assert.equal(diff.code, 0, diff.stderr);
    assert.match(diff.stdout, /on feature-x: save 1 → save 2/);
    assert.match(diff.stdout, /-first/);
    assert.match(diff.stdout, /\+second/);
    const used = await nb(["file", "use", "src/app.ts", "1", "--json"]);
    assert.equal(used.code, 0, used.stderr);
    assert.equal(JSON.parse(used.stdout).data.from, 1);
    assert.equal(b.files.get("/src/app.ts").content.toString(), "first\n", "a save on the branch");
    assert.equal(api.state.files.get("/src/app.ts")?.content.toString(), "main app\n", "main is untouched");
  });

  it("nb init --branch starts the folder on that branch (by id); an unknown branch says how to make it", async () => {
    await nb(["branch", "create", "feature-x", "--no-switch"]);
    const other = await tempDir("nb-init-branch-");
    const linked = await runCli(["init", "design-lab", "--branch", "Feature-X"], { api: api.url, cwd: other, home });
    assert.equal(linked.code, 0, linked.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(other, ".networkbase", "config.json"), "utf8"));
    assert.deepEqual(cfg.branch, { id: branch("feature-x").id, name: "feature-x" });
    const missing = await runCli(["init", "design-lab", "--branch", "nope"], { api: api.url, cwd: await tempDir("nb-init-missing-"), home });
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /nb branch create nope/);
  });

  it("the folder's branch was deleted: the next command says so; switching to main works and keeps edits", async () => {
    await nb(["branch", "create", "feature-x"]);
    write("src/app.ts", "my edit\n");
    branch("feature-x").status = "deleted";
    const status = await nb(["status"]);
    assert.notEqual(status.code, 0);
    assert.match(status.stderr, /deleted/);
    assert.match(status.stderr, /nb branch switch main/);
    const back = await nb(["branch", "switch", "main", "--carry"]);
    assert.equal(back.code, 0, back.stderr);
    assert.equal(config().branch, null);
    assert.equal(read("src/app.ts"), "my edit\n", "the edit is kept");
  });

  it("a branch renamed elsewhere keeps the folder on it (by id); the next command shows the new name", async () => {
    await nb(["branch", "create", "feature-x"]);
    branch("feature-x").name = "feature-y";
    const status = await nb(["status", "--json"]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).data.branch, "feature-y");
    assert.equal(config().branch.name, "feature-y");
  });

  it("offline (H23 journey 9): making a branch says it needs the network; a push queued on a branch waits for that branch", async () => {
    const offline = { api: "http://127.0.0.1:9", env: { NB_RETRY_BUDGET_MS: "200" } };
    const made = await nb(["branch", "create", "feature-y"], offline);
    assert.notEqual(made.code, 0);
    assert.match(made.stderr, /Making a branch needs the network/);
    await nb(["branch", "create", "feature-x"]);
    write("src/app.ts", "queued on the branch\n");
    const queued = await nb(["push", "src/app.ts", "--yes"], offline);
    assert.notEqual(queued.code, 0);
    assert.ok(fs.existsSync(path.join(cwd, ".networkbase", "queue.json")), queued.stderr);
    const q = JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "queue.json"), "utf8"));
    assert.equal(q.entries[0].branch.name, "feature-x", "the queue keeps its branch");
    // Back on main, the queued push isn't sent to main.
    q.entries[0].branch = { id: branch("feature-x").id, name: "feature-x" };
    const cfg = config();
    fs.writeFileSync(path.join(cwd, ".networkbase", "config.json"), JSON.stringify({ ...cfg, branch: null }));
    const synced = await nb(["sync", "--yes"]);
    assert.match(synced.stderr + synced.stdout, /queued on feature-x waits for this folder to be on it/);
    const after = JSON.parse(fs.readFileSync(path.join(cwd, ".networkbase", "queue.json"), "utf8"));
    assert.equal(after.entries.length, 1, "it stays queued for feature-x");
  });

  it("a folder that pulled only some files switches without fetching the rest (M9 walkthrough)", async () => {
    const partial = await tempDir("nb-partial-");
    const run = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd: partial, home });
    assert.equal((await run(["init", "design-lab"])).code, 0);
    fs.writeFileSync(path.join(partial, "note.md"), "mine\n");
    assert.equal((await run(["push", "note.md", "--yes"])).code, 0);
    const before = api.requests.length;
    const made = await run(["branch", "create", "feature-p"]);
    assert.equal(made.code, 0, made.stderr);
    const fetched = api.requests.slice(before).filter((r) => r.path.endsWith("/raw"));
    assert.deepEqual(fetched, [], "README.md and src/app.ts stay on the server");
    assert.ok(!fs.existsSync(path.join(partial, "README.md")));
    assert.equal(fs.readFileSync(path.join(partial, "note.md"), "utf8"), "mine\n");
  });

  it("a merged branch can still be deleted by name (M9 walkthrough)", async () => {
    await nb(["branch", "create", "feature-m", "--no-switch"]);
    branch("feature-m").status = "merged";
    const gone = await nb(["branch", "delete", "feature-m", "--yes"]);
    assert.equal(gone.code, 0, gone.stderr);
    assert.equal(branch("feature-m").status, "deleted");
  });

  it("offline (H23 journey 9): switching back to a branch this folder had works from what it kept, labelled offline", async () => {
    await nb(["branch", "create", "feature-x"]);
    write("src/app.ts", "branch app\n");
    assert.equal((await nb(["push", "src/app.ts", "--yes"])).code, 0);
    assert.equal((await nb(["branch", "switch", "main"])).code, 0);
    assert.equal(read("src/app.ts"), "main app\n");
    const offline = { api: "http://127.0.0.1:9", env: { NB_RETRY_BUDGET_MS: "200" } };
    const back = await nb(["branch", "switch", "feature-x"], offline);
    assert.equal(back.code, 0, back.stderr);
    assert.match(back.stdout, /On feature-x \(offline\)/);
    assert.equal(read("src/app.ts"), "branch app\n");
    assert.equal(config().branch.name, "feature-x");
    const main = await nb(["branch", "switch", "main"], offline);
    assert.equal(main.code, 0, main.stderr);
    assert.equal(read("src/app.ts"), "main app\n");
    const never = await nb(["branch", "switch", "feature-z"], offline);
    assert.notEqual(never.code, 0);
    assert.match(never.stderr, /needs the network/);
  });
});
