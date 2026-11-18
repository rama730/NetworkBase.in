import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report H6 (M8, phase H-3): nb merge-request create, list, view, review, comment, apply, merge, close, reopen, ready.
// Without a number they use the open merge request of the folder's branch (which follows git).
describe("nb merge-request", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args, extra = {}) => runCli(args, { api: api.url, cwd, home, ...extra });
  const state = () => /** @type {any} */ (api.state);

  beforeEach(async () => {
    api = await startFakeServer();
    state().branchesOn = true;
    putFile(api.state, "/src/app.ts", Buffer.from("main app\n"));
    cwd = await tempDir("nb-mr-");
    home = await tempDir("nb-home-");
    assert.equal((await nb(["init", "design-lab"])).code, 0);
    assert.equal((await nb(["pull", "--yes"])).code, 0);
  });
  afterEach(() => api.close());

  it("create opens one from this folder's branch; on main it says to use a branch; list and view show it", async () => {
    const onMain = await nb(["merge-request", "create"]);
    assert.equal(onMain.code, 2, onMain.stderr);
    assert.match(onMain.stderr, /on main/);
    await nb(["branch", "create", "feature-x"]);
    const made = await nb(["mr", "create", "--draft", "-m", "Closes #4", "--reviewer", "@sam"]);
    assert.equal(made.code, 0, made.stderr);
    assert.match(made.stdout, /Opened !1 feature-x \(draft\)/);
    assert.deepEqual(state().mergeRequests[0].body, { source: "feature-x", target: "main", description: "Closes #4", draft: true, reviewers: ["@sam"] });
    const again = await nb(["mr", "create"]);
    assert.equal(again.code, 4, "one open per branch");
    const list = await nb(["merge-request", "list", "--review-requested"]);
    assert.equal(list.code, 0, list.stderr);
    assert.equal(state().lastMrQuery.get("review"), "1");
    assert.match(list.stdout, /!1/);
    const view = await nb(["mr", "view"]);
    assert.equal(view.code, 0, view.stderr);
    assert.match(view.stdout, /!1 .*feature-x/);
    assert.match(view.stdout, /Files changed \(1\)/);
  });

  it("review, comment with a suggestion, apply it; merge asks first and reports conflicts with exit 4", async () => {
    await nb(["branch", "create", "feature-x"]);
    await nb(["mr", "create"]);
    assert.equal((await nb(["mr", "review"])).code, 2, "needs --approve, --request-changes or --comment");
    assert.equal((await nb(["mr", "review", "1", "--approve"])).code, 0);
    assert.equal((await nb(["mr", "comment", "1", "--suggest", "x"])).code, 2, "a suggestion needs --file and --line");
    const c = await nb(["mr", "comment", "1", "-m", "rename", "--file", "src/app.ts", "--line", "1-2", "--suggest", "better"]);
    assert.equal(c.code, 0, c.stderr);
    assert.deepEqual(state().mrPosts.at(-1).body, { body: "rename", path: "src/app.ts", line: 1, endLine: 2, suggestion: "better" });
    const id = state().mergeRequests[0].comments[0].id.slice(0, 8);
    assert.equal((await nb(["mr", "apply", "1", id])).code, 0);
    assert.equal(state().mrPosts.at(-1).op, "suggestions");
    state().mergeAnswer = { outcome: "conflicts", conflicts: [{ path: "/src/app.ts", kind: "edit" }] };
    const held = await nb(["mr", "merge", "--yes"]);
    assert.equal(held.code, 4, held.stderr);
    assert.match(held.stdout, /nb branch update/);
    state().mergeAnswer = null;
    const done = await nb(["mr", "merge", "1", "--squash", "--yes"]);
    assert.equal(done.code, 0, done.stderr);
    assert.equal(state().mrPosts.at(-1).body.method, "squash");
    assert.match(done.stdout, /Merged !1 into main \(save 9\)/);
  });

  it("close, reopen and ready send the change", async () => {
    await nb(["branch", "create", "feature-x"]);
    await nb(["mr", "create", "--draft"]);
    assert.equal((await nb(["mr", "ready", "1"])).code, 0);
    assert.equal(state().mergeRequests[0].state, "open");
    assert.equal((await nb(["mr", "close", "1"])).code, 0);
    assert.equal(state().mergeRequests[0].state, "closed");
    assert.equal((await nb(["merge-request", "reopen", "!1"])).code, 0);
    assert.equal(state().mergeRequests[0].state, "open");
  });

  it("My reviews (H23): --review-requested --all lists what waits on you in every workspace", async () => {
    const other = await startFakeServer({ routes: { "GET /api/v1/me/reviews": () => ({ data: { reviews: [{ workspace: { id: "w2", slug: "site", title: "Site" }, number: 7, title: "New footer", source: "sam/footer", author: null, updatedAt: "2026-11-18T09:00:00Z", href: "/workspaces/site?tab=files&mr=7" }] } }) } });
    try {
      const listed = await runCli(["merge-request", "list", "--review-requested", "--all"], { api: other.url, home });
      assert.equal(listed.code, 0, listed.stderr);
      assert.match(listed.stdout, /site +!7 +New footer/);
    } finally { other.close(); }
  });
});
