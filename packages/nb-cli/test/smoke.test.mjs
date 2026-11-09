import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, CLI_PACKAGE, tempDir } from "./helpers/run-cli.mjs";

describe("nb 2.0 basics", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("--version prints the package version", async () => {
    const r = await runCli(["--version"], { api: api.url });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), CLI_PACKAGE.version);
  });

  it("whoami --json prints one envelope on stdout and nothing else", async () => {
    const r = await runCli(["whoami", "--json"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.schema, "nb.whoami/1");
    assert.equal(out.data.user.username, "tester");
    assert.equal(r.stdout.trim().split("\n").length, 1);
  });

  it("not signed in → exit 3 with the next step", async () => {
    const r = await runCli(["whoami"], { api: api.url, token: null });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /not signed in/);
    assert.match(r.stderr, /nb login/);
  });

  it("a typo suggests the command and exits 2 (report A4.2)", async () => {
    const r = await runCli(["task", "lst"], { api: api.url });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Did you mean: nb task list\?/);
  });

  it("an unknown flag is an error, not ignored (finding 81)", async () => {
    const r = await runCli(["push", "a.txt", "--deliverables"], { api: api.url });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /has no --deliverables flag/);
  });

  it("errors in --json are an envelope too", async () => {
    const r = await runCli(["task", "lst", "--json"], { api: api.url });
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.error.code, "UNKNOWN_COMMAND");
  });

  it("help --json describes every command for agents and completions", async () => {
    const r = await runCli(["help", "--json"], { api: api.url });
    const out = JSON.parse(r.stdout);
    assert.ok(out.data.commands.some((/** @type {any} */ c) => c.name === "task count"));
  });

  it("removed 1.x commands say why", async () => {
    const r = await runCli(["hook", "install"], { api: api.url });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /removed in 2\.0/);
  });

  it("a project file can't send the token to another server (finding 28)", async () => {
    const cwd = await tempDir("nb-evil-");
    fs.mkdirSync(path.join(cwd, ".networkbase"));
    fs.writeFileSync(path.join(cwd, ".networkbase", "config.json"), JSON.stringify({ projectId: WORKSPACE_ID, apiUrl: "http://127.0.0.1:1" }));
    const r = await runCli(["whoami", "--json"], { api: api.url, cwd });
    assert.equal(r.code, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).meta.warnings[0], /Ignoring the server address/, "in --json, warnings ride in the envelope");
    assert.ok(api.requests.some((q) => q.path === "/api/v1/me"), "the request went to the signed-in server");
  });

  it("never touches the real ~/.networkbase", async () => {
    const real = path.join(os.homedir(), ".networkbase", "credentials.json");
    const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null;
    const r = await runCli(["whoami", "--json"], { api: api.url });
    assert.notEqual(r.home, os.homedir());
    assert.equal(fs.existsSync(real) ? fs.statSync(real).mtimeMs : null, before);
  });
});
