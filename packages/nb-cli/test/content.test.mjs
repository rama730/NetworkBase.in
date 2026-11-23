import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { parsePublish } from "../lib/commands/content.mjs";

// Report 38.8 W12 (plan A2.9): nb content add|list|ideas|published.
describe("nb content", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => {
    api = await startFakeServer();
    addTask(api.state, { title: "Pricing guide" });
    const now = new Date();
    /** @type {any} */ (api.state).content = [
      { id: "c1", number: 1, title: "Pricing guide", stage: "scheduled", publishAt: now.toISOString(), channels: ["blog", "linkedin"], writer: "Mei", published: [] },
      { id: "c2", number: 2, title: "Year in review", stage: "drafting", publishAt: new Date(now.getTime() + 40 * 86_400_000).toISOString(), channels: ["blog"], writer: "Mei", published: [] },
      { id: "c3", number: 3, title: "Behind the scenes", stage: "idea", publishAt: null, channels: [], writer: null, published: [] },
      { id: "c4", number: 4, title: "Dropped teaser", stage: "cancelled", publishAt: now.toISOString(), channels: ["blog"], writer: "Mei", published: [] },
    ];
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("publish times: a day and time, a day, or a word", () => {
    assert.deepEqual(parsePublish("2026-12-03T10:00"), { day: "2026-12-03", time: "10:00" });
    assert.deepEqual(parsePublish("2026-12-03 09:30"), { day: "2026-12-03", time: "09:30" });
    assert.deepEqual(parsePublish("2026-12-03"), { day: "2026-12-03" });
    assert.equal(parsePublish("2026-12-03T25:00"), null);
    assert.ok(parsePublish("friday")?.day);
  });

  it("add sends channels, type and the publish time; no time makes an idea", async () => {
    const r = await nb(["content", "add", "Pricing guide", "--channels", "blog,linkedin", "--type", "article", "--publish", "2026-12-03T10:00"]);
    assert.equal(r.code, 0, r.stderr);
    const body = api.state.lastCreate;
    assert.deepEqual({ itemType: body.itemType, stage: body.stage, typeFields: body.typeFields, dueDate: body.dueDate },
      { itemType: "content", stage: "drafting", typeFields: { channels: ["blog", "linkedin"], contentType: "article", publishTime: "10:00" }, dueDate: "2026-12-03" });
    assert.equal((await nb(["content", "add", "Behind the scenes"])).code, 0);
    assert.deepEqual([api.state.lastCreate.stage, api.state.lastCreate.typeFields], ["idea", {}]);
    assert.match((await nb(["content", "add", "X", "--channels", "tiktok"])).stderr, /No channel "tiktok"/);
    assert.match((await nb(["content", "add", "X", "--publish", "someday"])).stderr, /isn't a date I know/);
  });

  it("list leaves ideas out; --week keeps this week's; ideas lists the rail", async () => {
    const all = await nb(["content", "list", "--json"]);
    assert.deepEqual(JSON.parse(all.stdout).data.items.map((/** @type {any} */ i) => i.number), [1, 2]);
    const week = await nb(["content", "list", "--week", "--json"]);
    assert.deepEqual(JSON.parse(week.stdout).data.items.map((/** @type {any} */ i) => i.number), [1]);
    const ideas = await nb(["content", "ideas", "--json"]);
    assert.deepEqual(JSON.parse(ideas.stdout).data.items.map((/** @type {any} */ i) => i.number), [3]);
  });

  it("published sends a link per channel", async () => {
    const r = await nb(["content", "published", "1", "--link", "linkedin=https://www.linkedin.com/posts/pricing"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(api.state.lastUpdate.links, { linkedin: { link: "https://www.linkedin.com/posts/pricing" } });
    assert.equal(api.state.lastUpdate.kind, "content_published");
    assert.match((await nb(["content", "published", "1", "--link", "nolink"])).stderr, /channel=https/);
  });
});
