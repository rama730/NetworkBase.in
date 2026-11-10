import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Found in the live agent check (2026-11-10): a long slug pushed doc list's file names out of line, and a refused
// README edit didn't say why.
describe("nb doc", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, env: { NB_PLAIN: "1" } });
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-docs-");
    await nb(["init", "design-lab"]);
    putFile(api.state, "/README.md", Buffer.from("# Hi\n"));
    putFile(api.state, "/CREATE_PROJECT_ENHANCEMENTS.md", Buffer.from("x"));
    api.state.docs.push({ slug: "readme", filename: "README.md", nodePath: "/README.md" }, { slug: "create_project_enhancements", filename: "CREATE_PROJECT_ENHANCEMENTS.md", nodePath: "/CREATE_PROJECT_ENHANCEMENTS.md" });
  });
  after(() => api.close());

  it("doc list lines file names up under the longest slug", async () => {
    const r = await nb(["doc", "list"]);
    assert.equal(r.code, 0, r.stderr);
    const columns = r.stdout.trimEnd().split("\n").map((line) => line.search(/[A-Z_]+\.md/));
    assert.equal(new Set(columns).size, 1, r.stdout);
  });

  it("a refused edit says who can edit", async () => {
    api.state.canWrite = false;
    const r = await nb(["doc", "set", "readme", "--file", "-"]);
    api.state.canWrite = true;
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /but not edit it/);
    assert.match(r.stderr, /owner and admins/);
  });

  it("plain output's marker is a dash, not an @ beside a name", async () => {
    const r = await nb(["whoami"]);
    assert.match(r.stdout, /^- @tester/m);
  });
});
