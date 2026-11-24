import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.17 W7 (plan A7.4, A7.5): nb update schedule, nb update scheduled, nb changelog.
describe("nb update schedule and nb changelog", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).feed = [
      { id: "u1", updateType: "release", createdAt: "2026-11-24T10:00:00Z", content: "## v2.4\n\n### Added\n- Docs site" },
      { id: "u2", updateType: null, createdAt: "2026-11-23T10:00:00Z", content: "Weekly notes" },
    ];
  });
  after(() => api.close());

  it("schedules at a local time and lists what waits", async () => {
    const r = await runCli(["update", "schedule", "--at", "2026-12-03 10:00", "-m", "Launch day", "--release", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Scheduled · posts/);
    const sent = /** @type {any} */ (api.state).scheduled[0];
    assert.equal(sent.publishAt, new Date("2026-12-03T10:00").toISOString());
    assert.equal(sent.release, true);
    const list = await runCli(["update", "scheduled", "-w", "design-lab"], { api: api.url });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /Launch day/);
  });

  it("needs a time; changelog prints release Updates only", async () => {
    const bad = await runCli(["update", "schedule", "-m", "x", "-w", "design-lab"], { api: api.url });
    assert.notEqual(bad.code, 0);
    const r = await runCli(["changelog", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /## v2\.4[\s\S]*Docs site/);
    assert.doesNotMatch(r.stdout, /Weekly notes/);
  });
});
