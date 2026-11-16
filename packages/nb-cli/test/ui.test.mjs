import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { runTty, TTY_SUPPORTED } from "./helpers/run-tty.mjs";
import { render } from "../lib/commands/ui.mjs";

const plainColors = { bold: (/** @type {string} */ t) => t, muted: (/** @type {string} */ t) => t, brand: (/** @type {string} */ t) => t, accent: (/** @type {string} */ t) => t };

// Report C9 (M4d): nb ui, three panes, keys, 80 columns, --plain is nb status.
describe("nb ui (C9)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("draws three panes within 80 columns and the screen's height; the filter narrows rows; ? lists the keys", () => {
    const long = "x".repeat(200);
    /** @type {any} */
    const s = { pane: 1, sel: [0, 1, 0], filter: "", typing: false, help: false, note: "", head: `NetworkBase · design-lab · #4 ${long}`,
      panes: [{ title: "Tasks", rows: [{ label: "#4 Logo", hint: "due soon" }, { label: `#5 ${long}` }], empty: "" }, { title: "Inbox", rows: [{ label: "• Sam commented" }, { label: "  Ann liked" }], empty: "" }, { title: "Changed here", rows: [], empty: "Up to date" }] };
    const lines = render(s, 80, 24, plainColors);
    assert.ok(lines.length <= 24);
    for (const l of lines) assert.ok([...l].length <= 80, l);
    assert.match(lines.join("\n"), /▸ Inbox \(2\)\n    • Sam commented\n  › {3}Ann liked/);
    assert.match(lines.join("\n"), /Changed here \(0\)\n    Up to date/);
    assert.match(render({ ...s, filter: "logo" }, 80, 24, plainColors).join("\n"), /Tasks \(1\)/);
    assert.match(render({ ...s, help: true }, 80, 24, plainColors).join("\n"), /Keys\n\s+↑ ↓  j k\s+move/);
  });

  it("in a script, or with --plain, it prints nb status", async () => {
    const cwd = await tempDir("nb-ui-");
    const home = await tempDir("nb-ui-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    for (const args of [["ui"], ["ui", "--plain"]]) {
      const r = await runCli(args, { api: api.url, cwd, home });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /design-lab/);
    }
  });

  it("in a terminal it shows the panes, moves, lists the keys and quits with q", { skip: !TTY_SUPPORTED && "needs a pseudo-terminal" }, async () => {
    addTask(api.state, { title: "Ship the logo", status: "in_progress" });
    api.state.inbox.push({ id: "n9", title: "Sam commented on #1", body: "nice", createdAt: new Date().toISOString(), readAt: null });
    const cwd = await tempDir("nb-ui-tty-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home: await tempDir("nb-ui-tty-h-") });
    const r = await runTty(["ui"], { api: api.url, cwd, keys: ["\t", "?", "x", "q"], timeoutMs: 20_000 });
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /Tasks \(\d+\)/);
    assert.match(r.output, /#\d+ Ship the logo/);
    assert.match(r.output, /Inbox \(\d+\)/);
    assert.match(r.output, /Sam commented on #1/);
    assert.match(r.output, /Keys/);
  });
});
