import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.10 W10 (plan A3.1): nb launches list.
describe("nb launches", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).launches = [
      { slug: "v2-4", name: "v2.4", date: "2026-12-12", stage: "getting_ready", done: 14, total: 31 },
      { slug: "v2-3", name: "v2.3", date: "2026-11-01", stage: "closed", done: 20, total: 20 },
    ];
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("list leaves closed launches out unless --all", async () => {
    const r = await nb(["launches", "list"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /v2\.4.*2026-12-12.*getting ready.*14 of 31/);
    assert.doesNotMatch(r.stdout, /v2\.3/);
    assert.equal(JSON.parse((await nb(["launches", "list", "--all", "--json"])).stdout).data.launches.length, 2);
  });
});
