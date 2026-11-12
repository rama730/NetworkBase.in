import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C8 (M4b): tab completion with real names from a cache that is never older than 10 minutes.
describe("completion with real names", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-complete-");
    home = await tempDir("nb-complete-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("answers from the cache: task numbers with titles, members, file paths", async () => {
    addTask(api.state, { title: "Fix the login" });
    putFile(api.state, "/docs/plan.md", Buffer.from("x"));
    assert.equal((await nb(["complete", "--refresh"])).code, 0);
    assert.equal((await nb(["complete", "tasks"])).stdout, "1\tFix the login");
    assert.match((await nb(["complete", "members"])).stdout, /@sam/);
    assert.equal((await nb(["complete", "files", "docs/"])).stdout, "docs/plan.md");
  });

  it("an old cache still answers at once and is refreshed behind", async () => {
    const dir = path.join(home, ".networkbase", "complete");
    const file = path.join(dir, fs.readdirSync(dir)[0] ?? "");
    const cache = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...cache, at: Date.now() - 11 * 60_000 }));
    addTask(api.state, { title: "New one" });
    assert.equal((await nb(["complete", "tasks"])).stdout, "1\tFix the login", "the old names, without waiting");
    for (let i = 0; i < 60 && JSON.parse(fs.readFileSync(file, "utf8")).tasks.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    assert.match((await nb(["complete", "tasks"])).stdout, /2\tNew one/, "refreshed behind");
  });

  it("the shell scripts ask for names after commands that take them", async () => {
    const zsh = (await nb(["completion", "zsh"])).stdout;
    assert.match(zsh, /"task start"\) kind=tasks;;/);
    assert.match(zsh, /nb complete \$kind/);
    assert.match((await nb(["completion", "bash"])).stdout, /"push"\) kind=files;;/);
    assert.match((await nb(["completion", "fish"])).stdout, /__fish_seen_subcommand_from member; and __fish_seen_subcommand_from role' -a '\(nb complete members/);
  });
});
