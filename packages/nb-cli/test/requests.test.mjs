import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { answersFor, pickType } from "../lib/commands/requests.mjs";

// Report 38.7 W13 (plan A2.6): nb requests new|list|accept|decline|wait|deliver.
describe("nb requests", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    addTask(api.state, { title: "Banner" });
    /** @type {any} */ (api.state).requests = [
      { id: "r1", number: 1, title: "Banner", stage: "accepted", type: "Design request", askedBy: "Sam", askedById: "x", assigneeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clock: { kind: "deliver", state: "soon", leftMinutes: 70 } },
      { id: "r2", number: 2, title: "Analytics", stage: "new", type: "General request", askedBy: "Sam", askedById: "x", clock: { kind: "first", state: "breached", leftMinutes: -40 } },
      { id: "r3", number: 3, title: "Laptop", stage: "new", type: "General request", askedBy: "Sam", askedById: "x", clock: { kind: "first", state: "running", leftMinutes: 200 } },
    ];
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("types are found by a short name; fields by id or label", () => {
    const types = [{ name: "General request", questions: [] }, { name: "Design request", questions: [{ id: "brief", label: "Brief" }, { id: "what", label: "What’s needed" }] }];
    assert.equal(pickType(types, "design")?.name, "Design request");
    assert.equal(pickType(types, "request"), null, "not unique");
    assert.deepEqual(answersFor(types[1], ["Brief=Launch", "whats needed=Banner"]), { brief: "Launch", what: "Banner" });
    assert.throws(() => answersFor(types[1], ["size=big"]), /no question "size"/);
  });

  it("new sends the type, the answers and Need by, unassigned at New", async () => {
    const r = await nb(["requests", "new", "Banner for the launch", "--type", "design", "--field", "what=Banner", "--field", "brief=1500x500", "--need-by", "2026-12-01"]);
    assert.equal(r.code, 0, r.stderr);
    const body = api.state.lastCreate;
    assert.deepEqual({ itemType: body.itemType, stage: body.stage, typeFields: body.typeFields, dueDate: body.dueDate, assignee: body.assigneeId },
      { itemType: "request", stage: "new", typeFields: { requestTypeId: "aaaaaaaa-0000-4000-8000-000000000002", answers: { what: "Banner", brief: "1500x500" } }, dueDate: "2026-12-01", assignee: undefined });
    assert.match((await nb(["requests", "new", "X", "--type", "legal"])).stderr, /No request type "legal"/);
  });

  it("list --breaching sorts by time left and words the clock", async () => {
    const r = await nb(["requests", "list", "--breaching", "--plain"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Analytics[\s\S]*breached 40 m ago[\s\S]*Banner[\s\S]*1 h 10 m left/);
    assert.doesNotMatch(r.stdout, /Laptop/);
  });

  it("accept, decline, wait and deliver send their kinds", async () => {
    assert.match((await nb(["requests", "decline", "1"])).stderr, /--reason/);
    assert.equal((await nb(["requests", "decline", "1", "--reason", "Not now"])).code, 0);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.reason], ["request_decline", "Not now"]);
    assert.equal((await nb(["requests", "deliver", "1", "--link", "https://files.example/b.png"])).code, 0);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.link], ["request_deliver", "https://files.example/b.png"]);
    const accepted = await nb(["requests", "accept", "1", "--to", "me"]);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(api.state.lastUpdate.kind, "request_accept");
    const waited = await nb(["requests", "wait", "1", "--on", "me", "Which logo?"]);
    assert.equal(waited.code, 0, waited.stderr);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.question], ["request_wait", "Which logo?"]);
  });
});
