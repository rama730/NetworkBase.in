import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C1: nb on its own knows where you are; advice comes in the right order; nb init suggests by name.
describe("home screen (C1)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    api.state.extraWorkspaces = [{ id: "cccccccc-3333-4333-8333-333333333333", title: "Ponytail", slug: "ponytail", role: "owner" }];
  });
  after(() => api.close());

  it("signed out: nb says to sign in, not a page of help", async () => {
    const r = await runCli([], { api: api.url, token: null });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /not signed in/i);
    assert.match(r.stdout, /nb login/);
    assert.ok(r.stdout.split("\n").length < 15, "a home screen, not the help page");
    // Found live: a display flag alone is still the home screen.
    assert.match((await runCli(["--plain"], { api: api.url, token: null })).stdout, /not signed in/i);
    assert.match((await runCli(["--help"], { api: api.url, token: null })).stdout, /Most used/);
  });

  it("signed out: a command that needs a folder says sign in first, not link this folder", async () => {
    for (const args of [["status"], ["task", "list"], ["push"]]) {
      const r = await runCli(args, { api: api.url, token: null });
      assert.equal(r.code, 3, args.join(" "));
      assert.match(r.stderr, /Sign in first/, args.join(" "));
      assert.doesNotMatch(r.stderr, /isn't linked/, args.join(" "));
    }
  });

  it("signed in, folder not linked: suggests the workspace that matches the folder name", async () => {
    const cwd = path.join(await tempDir("nb-home-"), "ponytail");
    fs.mkdirSync(cwd);
    const r = await runCli([], { api: api.url, cwd });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /isn't linked/);
    assert.match(r.stdout, /nb init ponytail/);
    const json = JSON.parse((await runCli([], { api: api.url, cwd, env: { NB_JSON: "1" } })).stdout);
    assert.equal(json.schema, "nb.home/1");
    assert.equal(json.data.state, "not-linked");
    assert.deepEqual(json.data.matches.map((/** @type {any} */ m) => m.slug), ["ponytail"]);
  });

  it("a git repository's name counts too", async () => {
    const cwd = path.join(await tempDir("nb-home-"), "web");
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:me/design-lab.git\n');
    const json = JSON.parse((await runCli([], { api: api.url, cwd, env: { NB_JSON: "1" } })).stdout);
    assert.deepEqual(json.data.matches.map((/** @type {any} */ m) => m.slug), ["design-lab"]);
  });

  it("linked: nb is nb status with the day's counts on top", async () => {
    const cwd = await tempDir("nb-home-linked-");
    const home = await tempDir("nb-home-h-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    // Totals cover every workspace; the folder shows its own workspace's (M9 walkthrough).
    api.state.home = { tasks: { open: 5, byStatus: { todo: 2, in_progress: 2, blocked: 0, in_review: 0 }, overdue: 2, dueThisWeek: 3, workspaces: [{ id: WORKSPACE_ID, title: "Design Lab", open: 4, overdue: 1, dueThisWeek: 3 }, { id: "other", title: "Other", open: 1, overdue: 1, dueThisWeek: 0 }] }, unread: 2 };
    const r = await runCli([], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /3 due this week · 1 overdue · 2 unread/);
    fs.writeFileSync(path.join(cwd, "new.md"), "hello");
    assert.match((await runCli(["status"], { api: api.url, cwd, home })).stdout, /2 unread · 1 file changed here/);
    assert.match(r.stdout, /design-lab/);
    const s = JSON.parse((await runCli(["status", "--json"], { api: api.url, cwd, home })).stdout);
    assert.deepEqual(s.data.today, { dueThisWeek: 3, overdue: 1, unread: 2 });
  });

  it("nb init with no name puts the matching workspace first", async () => {
    const cwd = path.join(await tempDir("nb-home-"), "ponytail");
    fs.mkdirSync(cwd);
    const r = await runCli(["init", "--json"], { api: api.url, cwd });
    const out = JSON.parse(r.stdout || r.stderr);
    // No terminal to ask in: the choices come back with the match recommended.
    const options = out.error?.details?.questions?.[0]?.options;
    assert.equal(options?.[0]?.value, "ponytail", r.stdout + r.stderr);
  });
});
