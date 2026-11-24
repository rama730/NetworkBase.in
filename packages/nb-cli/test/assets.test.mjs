import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.16 W10 (plan A7.1): nb assets list and tag.
describe("nb assets", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).assets = [
      { path: "/brand/Logo-dark.svg", name: "Logo-dark.svg", type: "logo", version: 3, tags: ["brand"], productionStatus: "final", usageRights: null },
      { path: "/shoot/intro.mp4", name: "intro.mp4", type: "video", version: 1, tags: [], productionStatus: null, usageRights: null },
    ];
  });
  after(() => api.close());

  it("lists file, type, status, tags and version, and filters by type", async () => {
    const r = await runCli(["assets", "list", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /\/brand\/Logo-dark\.svg\s+logo\s+Final\s+brand\s+v3/);
    const logos = await runCli(["assets", "list", "--type", "logo", "-w", "design-lab"], { api: api.url });
    assert.doesNotMatch(logos.stdout, /intro\.mp4/);
  });

  it("tags a file; a missing file fails", async () => {
    const r = await runCli(["assets", "tag", "/shoot/intro.mp4", "teaser", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /intro\.mp4 tagged teaser/);
    const miss = await runCli(["assets", "tag", "/nope.png", "x", "-w", "design-lab"], { api: api.url });
    assert.notEqual(miss.code, 0);
  });
});
