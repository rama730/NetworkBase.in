import { it } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer, addTask } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { createOutput, pickFields } from "../lib/print/out.mjs";
import { hyperlinks } from "../lib/print/style.mjs";

// Report A4.8 (--fields), A5.9 (links), A4.10 (pager).
it("pickFields keeps the named keys of each listed item", () => {
  assert.deepEqual(pickFields({ tasks: [{ id: 1, title: "a", x: 2 }], total: 1 }, ["id", "title"]), { tasks: [{ id: 1, title: "a" }], total: 1 });
  assert.deepEqual(pickFields({ id: 1, title: "a", x: 2 }, ["id"]), { id: 1 });
  assert.deepEqual(pickFields([{ a: 1, b: 2 }], ["b"]), [{ b: 2 }]);
});

it("nb task list --json --fields number,title", async () => {
  const api = await startFakeServer();
  try {
    addTask(api.state, { title: "Logo" });
    const cwd = await tempDir("nb-fields-");
    const home = await tempDir("nb-fields-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["task", "list", "--json", "--fields", "number,title"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).data.tasks, [{ number: 1, title: "Logo" }]);
  } finally {
    await api.close();
  }
});

it("links only in terminals that show them, only to the server's own pages", () => {
  const tty = /** @type {any} */ ({ isTTY: true });
  assert.equal(hyperlinks(tty, { TERM_PROGRAM: "iTerm.app" }), true);
  assert.equal(hyperlinks(tty, { TERM_PROGRAM: "Apple_Terminal" }), false);
  assert.equal(hyperlinks(tty, { TERM_PROGRAM: "iTerm.app", CI: "1" }), false);
  assert.equal(hyperlinks(/** @type {any} */ ({ isTTY: false }), { NB_LINKS: "1" }), true);
  const out = createOutput({}, { stdout: tty, stderr: /** @type {any} */ ({ isTTY: true, write() { return true; } }), env: { NB_LINKS: "1", FORCE_COLOR: "1" } });
  assert.equal(out.link("#4", "https://networkbase.in/w?task=4", "https://networkbase.in"), "\x1b]8;;https://networkbase.in/w?task=4\x1b\\#4\x1b]8;;\x1b\\");
  assert.equal(out.link("#4", "https://evil.example/x", "https://networkbase.in"), "#4");
});
