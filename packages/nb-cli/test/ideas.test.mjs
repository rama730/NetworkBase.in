import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.13 W9 (plan A5.3): nb ideas list, nb ideas add.
describe("nb ideas", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).ideas = { doc: "ideas", dropped: 1, ideas: [
      { rank: 1, number: 40, title: "Template shop", impact: 4, ease: 3, confidence: 2, score: 24, stage: "validating" },
      { rank: null, number: 41, title: "Dark mode", impact: null, ease: null, confidence: null, score: null, stage: "idea" }] };
  });
  after(() => api.close());
  /** @param {string[]} args */
  const nb = (args) => runCli([...args, "-w", "design-lab"], { api: api.url });

  it("ideas list ranks by score with unscored last and counts dropped", async () => {
    const r = await nb(["ideas", "list"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1\s+Template shop\s+4·3·2\s+24\s+validating/);
    assert.match(r.stdout, /–\s+Dark mode\s+–·–·–\s+not scored/);
    assert.match(r.stdout, /1 dropped/);
  });

  it("ideas add sends the name and scores; scores outside 1–5 are refused", async () => {
    const r = await nb(["ideas", "add", "Template shop", "--impact", "4", "--ease", "3", "--confidence", "2"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Added idea NB-77: Template shop/);
    assert.deepEqual(/** @type {any} */ (api.state).ideaAdds, [{ title: "Template shop", impact: 4, ease: 3, confidence: 2 }]);
    const bad = await nb(["ideas", "add", "X", "--impact", "9"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /--impact runs from 1 to 5/);
  });
});
