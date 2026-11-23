import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { parseWhere } from "../lib/commands/bugs.mjs";

// Report 38.6 W14 (plan A2.3): nb bugs report|move|close|from.
describe("nb bugs", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); addTask(api.state, { title: "Second" }); addTask(api.state, { title: "Third" }); });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("--where reads web:browser:version, app:platform:version, or words", () => {
    assert.deepEqual(parseWhere("web:firefox:132"), { kind: "web", browser: "firefox", version: "132" });
    assert.deepEqual(parseWhere("app:ios:17.2"), { kind: "app", platform: "ios", version: "17.2" });
    assert.deepEqual(parseWhere("the kiosk in hall B"), { kind: "other", text: "the kiosk in hall B" });
  });

  it("report sends a bug at New with its fields, unassigned", async () => {
    const r = await nb(["bugs", "report", "Crash on export", "--steps", "Open file\\nExport", "--expected", "A PDF", "--where", "web:firefox:132", "--severity", "major"]);
    assert.equal(r.code, 0, r.stderr);
    const body = api.state.lastCreate;
    assert.deepEqual({ itemType: body.itemType, stage: body.stage, typeFields: body.typeFields, assignee: body.assigneeId },
      { itemType: "bug", stage: "new", typeFields: { severity: "major", steps: "Open file\nExport", expected: "A PDF", where: { kind: "web", browser: "firefox", version: "132" } }, assignee: undefined });
    assert.match(r.stdout, /Reported #\d+ Crash on export · at New/);
    assert.match((await nb(["bugs", "report", "X", "--severity", "huge"])).stderr, /urgent, major or minor/);
  });

  it("move goes to a stage; closing stages point to nb bugs close", async () => {
    const r = await nb(["bugs", "move", "1", "fixing"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.stage], ["stage", "fixing"]);
    assert.match((await nb(["bugs", "move", "1", "wont_fix"])).stderr, /nb bugs close 1 --reason wont_fix/);
  });

  it("close asks first, needs --of for duplicates and a message for can't reproduce", async () => {
    assert.match((await nb(["bugs", "close", "1", "--reason", "duplicate"])).stderr, /--of/);
    assert.match((await nb(["bugs", "close", "1", "--reason", "cant_reproduce"])).stderr, /what you need/);
    const r = await nb(["bugs", "close", "1", "--reason", "duplicate", "--of", "2", "--answer", "close=yes"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.reason, typeof api.state.lastUpdate.duplicateOfId], ["bug_close", "duplicate", "string"]);
    api.state.lastUpdate = null;
    const kept = await nb(["bugs", "close", "1", "--reason", "wont_fix", "--answer", "close=no"]);
    assert.equal(kept.code, 0, kept.stderr);
    assert.equal(api.state.lastUpdate, null, "nothing sent");
  });

  it("from turns tasks into bugs", async () => {
    const r = await nb(["bugs", "from", "1", "2", "--stage", "confirmed"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([api.state.lastUpdate.kind, api.state.lastUpdate.toType, api.state.lastUpdate.stage], ["change_type", "bug", "confirmed"]);
    assert.match(r.stdout, /#1, #2 are bugs now/);
  });
});
