import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report F9: never colour alone. With colour on, every state still reads the same once the colour is taken away:
// the words and symbols carry the meaning, colour only adds to it.
const strip = (/** @type {string} */ s) => tidy(s.replace(/\x1b\[[0-9;]*m/g, ""));
/** Trailing spaces aside (a table pads differently when it colours a cell). @param {string} s */
const tidy = (s) => s.split("\n").map((l) => l.trimEnd().replace(/\d+ m?s\b/g, "N ms")).join("\n");

describe("never colour alone (report F9)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-colour-");
    home = await tempDir("nb-colour-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    addTask(api.state, { title: "Overdue thing", dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(), status: "in_progress" });
    addTask(api.state, { title: "Blocked thing", status: "blocked" });
    api.state.assignments.push({ id: "aaaaaaaa-0000-4000-8000-000000000001", number: 3, title: "Essay", due: new Date(Date.now() - 86_400_000).toISOString(), state: "missing", submissionType: "file", aiPolicy: "allowed", late: true });
  });
  after(() => api.close());

  for (const args of [["next"], ["task", "list", "--all"], ["status"], ["assignment", "list"], ["sprint", "view", "1"], ["class", "progress", "essay"], ["doctor"]]) {
    it(`nb ${args.join(" ")} says the same without colour`, async () => {
      const plain = await runCli(args, { api: api.url, cwd, home });
      const coloured = await runCli(args, { api: api.url, cwd, home, env: { NO_COLOR: "", FORCE_COLOR: "1", NODE_NO_WARNINGS: "1" } });
      assert.ok(/\x1b\[/.test(coloured.stdout + coloured.stderr) || !(plain.stdout + plain.stderr).trim(), `nb ${args.join(" ")} used colour`);
      assert.equal(strip(coloured.stdout), tidy(plain.stdout));
      assert.equal(strip(coloured.stderr), tidy(plain.stderr));
    });
  }
});
