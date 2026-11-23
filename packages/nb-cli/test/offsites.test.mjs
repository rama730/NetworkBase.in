import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 38.14 W7 (plan A5.4): nb offsites list.
describe("nb offsites", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).offsites = [{ slug: "o", name: "Team off-site", dateFrom: "2027-03-04", dateTo: "2027-03-06", place: "Goa", days: 12, counts: { going: 6, cant: 1, unanswered: 2 } }];
  });
  after(() => api.close());

  it("lists dates, name, place and answers", async () => {
    const r = await runCli(["offsites", "list", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /2027-03-04 → 2027-03-06\s+Team off-site\s+Goa\s+6 going · 1 can't · 2 not answered/);
  });
});
