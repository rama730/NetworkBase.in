import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, CLI_PACKAGE } from "./helpers/run-cli.mjs";

describe("nb 1.x smoke", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("--version prints the package version", async () => {
    const r = await runCli(["--version"], { api: api.url });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), CLI_PACKAGE.version);
  });

  it("whoami --json is signed in against the fake API", async () => {
    const r = await runCli(["whoami", "--json"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.authenticated, true);
    assert.equal(out.user.username, "tester");
    assert.ok(api.requests.some((q) => q.path === "/api/v1/extension/session" && q.headers.authorization === "Bearer nb_pat_test"));
  });

  it("a 503 from the session route reports signed out instead of crashing", async () => {
    api.setFault("/api/v1/extension/session", "503");
    try {
      const r = await runCli(["whoami", "--json"], { api: api.url });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).authenticated, false);
    } finally {
      api.setFault("/api/v1/extension/session", null);
    }
  });

  it("never touches the real ~/.networkbase", async () => {
    const real = path.join(os.homedir(), ".networkbase", "credentials.json");
    const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null;
    const r = await runCli(["whoami", "--json"], { api: api.url });
    assert.notEqual(r.home, os.homedir());
    const after = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null;
    assert.equal(after, before);
  });
});
