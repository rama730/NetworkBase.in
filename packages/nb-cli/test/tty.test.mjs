import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runTty, TTY_SUPPORTED } from "./helpers/run-tty.mjs";
import { matchSnapshot } from "./helpers/snapshot.mjs";

describe("nb in a terminal", { skip: !TTY_SUPPORTED && "needs a pseudo-terminal (macOS/Linux)" }, () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("prints help at 80 columns", async () => {
    const r = await runTty(["help"], { api: api.url, cols: 80 });
    assert.equal(r.code, 0, r.output);
    matchSnapshot("help-80", r.output);
  });

  it("reads keypresses in an interactive prompt", async () => {
    // With no link in the folder, `nb` asks to start setup; "n" then Enter declines.
    const r = await runTty([], { api: api.url, keys: ["n", "\r"] });
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /No, exit/);
    assert.match(r.output, /nb init whenever you're ready/);
  });
});
