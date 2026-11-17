import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report Part F (M7): workspace create, settings and archive; the agent policy; docs add and remove; whoami --security;
// nb export; nb api; logout --purge. Risky actions get "Verify it's you" from the server and the CLI says where.
describe("workspace admin, security and data from the terminal", () => {
  it("create, settings, policy (stricter only), doc add and remove", async () => {
    /** @type {any[]} */
    const calls = [];
    const W = `/api/v1/workspaces/${WORKSPACE_ID}`;
    const settings = { title: "Design Lab", slug: "design-lab", description: "Our site", visibility: "private", status: "active", agentPolicy: "ask_important", agentsPaused: false, branchesEnabled: true, protection: { requireMergeRequest: true, approvals: 1, agentsOnBranches: true } };
    const api = await startFakeServer({ routes: {
      "POST /api/v1/workspaces": (/** @type {any} */ req) => { calls.push(["create", req.body]); return { status: 201, data: { workspace: { id: "w2", slug: "new-site", title: req.body.title } } }; },
      [`GET ${W}/settings`]: () => ({ data: { settings, canChange: true } }),
      [`PATCH ${W}/settings`]: (/** @type {any} */ req) => { calls.push(["settings", req.body]); return { data: { settings: { ...settings, ...req.body }, canChange: true } }; },
      [`POST ${W}/agents`]: (/** @type {any} */ req) => { calls.push(["policy", req.body]); return req.body.policy === "trust_drafts_docs" ? { status: 403, body: { success: false, message: "Letting agents do more is done in the app", errorCode: "FORBIDDEN" } } : { data: { policy: req.body.policy, paused: false } }; },
      [`POST ${W}/docs`]: (/** @type {any} */ req) => { calls.push(["doc add", req.body]); return { status: 201, data: { success: true } }; },
      [`DELETE ${W}/docs/guide`]: () => { calls.push(["doc remove"]); return { data: { success: true } }; },
    } });
    try {
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const made = await runCli(["workspace", "create", "New site", "-m", "A site for the spring launch"], { api: api.url, env });
      assert.equal(made.code, 0, made.stderr);
      assert.match(made.stdout, /Created New site \(private\)/);
      assert.notEqual((await runCli(["workspace", "create", "No"], { api: api.url, env })).code, 0, "a title is 3 characters or more");
      const view = await runCli(["workspace", "settings"], { api: api.url, env });
      assert.match(view.stdout, /Agents +ask before important changes/);
      assert.match(view.stdout, /main +protected · 1 approval · agents on branches/);
      assert.equal((await runCli(["workspace", "settings", "--title", "Design Lab 2"], { api: api.url, env })).code, 0);
      assert.equal((await runCli(["agent", "policy", "ask-all"], { api: api.url, env })).code, 0);
      assert.notEqual((await runCli(["agent", "policy", "everything"], { api: api.url, env })).code, 0, "an unknown word");
      assert.equal((await runCli(["doc", "add", "docs\\guide.md"], { api: api.url, env })).code, 0);
      assert.equal((await runCli(["doc", "remove", "guide", "--yes"], { api: api.url, env })).code, 0);
      assert.deepEqual(calls, [
        ["create", { title: "New site", description: "A site for the spring launch", visibility: "private" }],
        ["settings", { title: "Design Lab 2" }],
        ["policy", { policy: "ask_all" }],
        ["doc add", { path: "docs/guide.md" }],
        ["doc remove"],
      ]);
    } finally { api.close(); }
  });

  it("archive and export need Verify it's you: without a terminal the CLI names the page; once verified it runs", async () => {
    const W = `/api/v1/workspaces/${WORKSPACE_ID}`;
    let verified = false;
    const stepUp = { status: 403, body: { success: false, message: "Verify it's you in the browser to archive a workspace", errorCode: "STEP_UP_REQUIRED", details: { url: "https://networkbase.test/cli/verify?s=abc" } } };
    const api = await startFakeServer({ routes: {
      [`POST ${W}/archive`]: () => (verified ? { data: { archived: true, message: "Archived" } } : stepUp),
      [`GET ${W}/export`]: () => (verified ? { raw: Buffer.from("PK zip") } : stepUp),
      "GET /api/v1/me/security": () => ({ data: { twoFactor: true, signIns: [{ name: "laptop", kind: "terminal", country: "IN", lastUsedAt: new Date().toISOString() }], events: [{ at: new Date().toISOString(), type: "cli_verified", label: "Terminal verified for risky actions" }] } }),
    } });
    try {
      const cwd = await tempDir("nb-admin-");
      const env = { NB_WORKSPACE: WORKSPACE_ID };
      const refused = await runCli(["workspace", "archive", "--yes"], { api: api.url, env, cwd });
      assert.notEqual(refused.code, 0);
      assert.match(refused.stderr, /cli\/verify\?s=abc/, "it says which page to open");
      verified = true;
      assert.equal((await runCli(["workspace", "archive", "--yes"], { api: api.url, env, cwd })).code, 0);
      const out = path.join(cwd, "backup.zip");
      const exported = await runCli(["export", "-o", out], { api: api.url, env, cwd });
      assert.equal(exported.code, 0, exported.stderr);
      assert.equal(fs.readFileSync(out, "utf8"), "PK zip");
      assert.notEqual((await runCli(["export", "-o", out], { api: api.url, env, cwd })).code, 0, "it won't replace a file without --force");
      const sec = await runCli(["whoami", "--security"], { api: api.url, env, cwd });
      assert.match(sec.stdout, /Two-factor +on/);
      assert.match(sec.stdout, /laptop .*terminal · IN/);
      assert.match(sec.stdout, /Terminal verified for risky actions/);
    } finally { api.close(); }
  });

  it("nb api calls a route with your sign-in; writes ask first; .. is refused", async () => {
    const api = await startFakeServer();
    try {
      const got = await runCli(["api", "GET", "/api/v1/me", "--json"], { api: api.url });
      assert.equal(got.code, 0, got.stderr);
      assert.ok(JSON.parse(got.stdout).data.user);
      assert.notEqual((await runCli(["api", "POST", "/api/v1/workspaces", "--data", "{}"], { api: api.url })).code, 0, "a write without --yes and without a terminal");
      assert.notEqual((await runCli(["api", "GET", "/api/v1/../secrets"], { api: api.url })).code, 0);
      assert.notEqual((await runCli(["api", "GET", "/api/v1/me", "--data", "{bad"], { api: api.url })).code, 0);
    } finally { api.close(); }
  });

  it("logout --purge removes what nb keeps; your files stay", async () => {
    const api = await startFakeServer();
    try {
      const home = await tempDir("nb-purge-home-");
      const cwd = await tempDir("nb-purge-");
      const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
      await nb(["init", "design-lab"]);
      fs.writeFileSync(path.join(cwd, "mine.txt"), "keep me");
      const purged = await nb(["logout", "--purge", "--yes"]);
      assert.equal(purged.code, 0, purged.stderr);
      assert.ok(!fs.existsSync(path.join(cwd, ".networkbase")), "the folder's .networkbase is gone");
      assert.ok(fs.existsSync(path.join(cwd, "mine.txt")), "your files stay");
      assert.ok(!fs.existsSync(path.join(home, ".networkbase")), "nb's own folder in your home is gone");
    } finally { api.close(); }
  });
});
