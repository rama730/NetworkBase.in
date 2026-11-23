import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.11 W12 (plan A4.1b): nb meetings list, nb decisions list.
describe("nb meetings and decisions", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    const at = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
    /** @type {any} */ (api.state).meetings = [
      { slug: "w2", title: "Weekly · next", type: "blank", startsAt: at(10), lengthMinutes: 30, finished: false, attendees: 3 },
      { slug: "w1", title: "Weekly · soon", type: "blank", startsAt: at(2), lengthMinutes: 30, finished: false, attendees: 3 },
      { slug: "w0", title: "Weekly · last", type: "blank", startsAt: at(-5), lengthMinutes: 30, finished: true, attendees: 3 },
    ];
    /** @type {any} */ (api.state).openActionItems = [{ number: 5, title: "Send the recap", due: null, assignee: null, meeting: "Weekly · last" }];
    /** @type {any} */ (api.state).decisions = [{ number: 2, label: "D-002", title: "Ship on Fridays", status: "decided", date: "2026-11-20", slug: "d2" },
      { number: 1, label: "D-001", title: "Ship on Mondays", status: "superseded", date: "2026-11-02", slug: "d1", supersededBy: "D-002" }];
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("meetings list shows what's coming (soonest first); --week keeps 7 days; --past the held ones", async () => {
    const up = JSON.parse((await nb(["meetings", "list", "--json"])).stdout).data;
    assert.deepEqual(up.meetings.map((/** @type {any} */ m) => m.slug), ["w1", "w2"]);
    assert.deepEqual(JSON.parse((await nb(["meetings", "list", "--week", "--json"])).stdout).data.meetings.map((/** @type {any} */ m) => m.slug), ["w1"]);
    assert.deepEqual(JSON.parse((await nb(["meetings", "list", "--past", "--json"])).stdout).data.meetings.map((/** @type {any} */ m) => m.slug), ["w0"]);
    assert.match((await nb(["meetings", "list"])).stdout, /1 open action item/);
  });

  it("decisions list shows D-numbers and status", async () => {
    const r = await nb(["decisions", "list"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /D-002.*Ship on Fridays.*decided/);
    assert.match(r.stdout, /D-001.*Ship on Mondays.*superseded by D-002/, "A4.2: what replaced it");
  });
});
