import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.12 W10 (plan A5.1b): nb goals list [--mine], nb goals checkin.
describe("nb goals", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).goals = { period: "2027-Q1", label: "Q1 2027", week: "week 7 of 13", viewerId: "me", objectives: [
      { number: 300, title: "Teams love the app", assignee: "Asha", assigneeId: "me", progress: 50, status: "on_track", keyResults: [
        { number: 301, title: "Weekly active teams", assigneeId: "me", current: 30, target: 50, unit: "teams", progress: 50, status: "on_track", confidence: 7, due: true, measuredBy: null },
        { number: 302, title: "Support tickets", assigneeId: "other", current: 32, target: 10, unit: "", progress: 26, status: "off_track", confidence: null, due: false, measuredBy: null }] },
      { number: 310, title: "Ship the mobile app", assigneeId: "other", progress: 0, status: "at_risk", keyResults: [] }] };
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("goals list shows objectives with their key results, progress, status and due check-ins; --mine keeps yours", async () => {
    const r = await nb(["goals", "list"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Q1 2027/);
    assert.match(r.stdout, /NB-301.*Weekly active teams.*30 \/ 50 teams.*on track.*check in/);
    assert.match(r.stdout, /NB-310.*Ship the mobile app.*at risk/);
    const mine = JSON.parse((await nb(["goals", "list", "--mine", "--json"])).stdout).data;
    assert.deepEqual(mine.objectives.map((/** @type {any} */ o) => [o.number, o.keyResults.map((/** @type {any} */ k) => k.number)]), [[300, [301]]]);
  });

  it("goals checkin sends the number, value, confidence and note; it refuses a missing confidence", async () => {
    const r = await nb(["goals", "checkin", "NB-301", "--value", "42", "--confidence", "7", "--note", "Two teams joined"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Checked in on NB-301: 42 · confidence 7\/10/);
    assert.deepEqual(/** @type {any} */ (api.state).checkins, [{ task: 301, value: 42, confidence: 7, note: "Two teams joined" }]);
    const bad = await nb(["goals", "checkin", "NB-301", "--value", "42"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /confidence from 1 to 10/);
  });
});
