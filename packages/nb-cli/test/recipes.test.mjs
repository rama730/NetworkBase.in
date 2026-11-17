import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addTask, startFakeServer, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report F10: every recipe in /docs/cli runs here, step by step, against the fake server, so the docs never go stale.
const here = path.dirname(fileURLToPath(import.meta.url));
const { recipes } = JSON.parse(fs.readFileSync(path.join(here, "..", "schema", "recipes.json"), "utf8"));

/** A command line as arguments, keeping "quoted words" together. @param {string} cmd */
const argv = (cmd) => (cmd.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, "")).slice(1);

describe("docs recipes (report F10)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    const W = `/api/v1/workspaces/${WORKSPACE_ID}`;
    api = await startFakeServer({ routes: {
      [`POST ${W}/agents`]: (/** @type {any} */ req) => ({ data: { policy: req.body.policy ?? "ask_important", paused: false } }),
      [`GET ${W}/agents`]: () => ({ data: { sessions: [] } }),
      [`GET ${W}/export`]: () => ({ raw: Buffer.from("PK") }),
    } });
    cwd = await tempDir("nb-recipes-");
    home = await tempDir("nb-recipes-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    addTask(api.state, { title: "Fix login" });
    api.state.assignments.push({ id: "aaaaaaaa-0000-4000-8000-000000000001", number: 3, title: "Essay", due: new Date(Date.now() + 86_400_000).toISOString(), state: "submitted", submissionType: "file", aiPolicy: "allowed" });
    fs.writeFileSync(path.join(cwd, "essay.md"), "# Essay\n");
    fs.writeFileSync(path.join(cwd, "report.md"), "# Report\n");
  });
  after(() => api.close());

  for (const recipe of recipes) {
    it(`${recipe.title}: every step runs`, async () => {
      for (const step of recipe.steps) {
        const res = await runCli(argv(step.cmd), { api: api.url, cwd, home });
        assert.equal(res.code, 0, `${step.cmd}\n${res.stderr}`);
      }
    });
  }
});
