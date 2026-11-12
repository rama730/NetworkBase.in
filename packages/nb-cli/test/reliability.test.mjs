import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ID, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { CLI_PATH, cleanEnv, runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C6 (M4b): the network dropping at every step of a push and a pull (before and after the server acts) loses
// and doubles nothing; an edit in the app while nb watch runs ends as a conflict copy, never lost work.
describe("reliability (C6)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c6-");
    home = await tempDir("nb-c6-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home, timeoutMs: 60_000 });
  const local = (/** @type {string} */ p) => fs.readFileSync(path.join(cwd, p), "utf8");
  const MANIFEST = `/api/v1/workspaces/${WORKSPACE_ID}/manifest`;

  for (const step of [MANIFEST, "/api/v1/files/place"]) {
    for (const how of /** @type {const} */ (["drop", "drop-after"])) {
      it(`push: the network drops ${how === "drop" ? "before" : "after"} the server acts on ${step.split("/").pop()}`, async () => {
        const name = `push-${step.split("/").pop()}-${how}.md`;
        fs.writeFileSync(path.join(cwd, name), "one");
        assert.equal((await nb(["push", name])).code, 0);
        fs.writeFileSync(path.join(cwd, name), "two");
        api.setFault(step, how);
        await nb(["push", name]);
        api.setFault(step, null);
        await nb(["sync"]);
        const remote = api.state.files.get(`/${name}`);
        assert.equal(remote?.content.toString(), "two", "nothing lost");
        assert.equal(remote?.version, 2, "nothing doubled");
      });
    }
  }

  for (const step of [MANIFEST, "/api/v1/extension/file"]) {
    it(`pull: the network drops on ${step.split("/").pop()}; the file stays whole and the next pull gets it`, async () => {
      const name = `pull-${step.split("/").pop()}.md`;
      putFile(api.state, `/${name}`, Buffer.from("server v1"));
      await nb(["pull"]);
      putFile(api.state, `/${name}`, Buffer.from("server v2"));
      api.setFault(step, "drop");
      await nb(["pull"]);
      assert.equal(local(name), "server v1", "never half a file");
      api.setFault(step, null);
      assert.equal((await nb(["pull"])).code, 0);
      assert.equal(local(name), "server v2");
      assert.deepEqual(fs.readdirSync(cwd).filter((f) => /\.(tmp|part)$/.test(f)), [], "no leftovers");
    });
  }

  it("an edit in the app while nb watch runs, with an unpushed edit here, becomes a conflict copy", async () => {
    putFile(api.state, "/shared.md", Buffer.from("v1"));
    await nb(["pull"]);
    fs.writeFileSync(path.join(cwd, "shared.md"), "my edit, not pushed");
    const { file } = putFile(api.state, "/shared.md", Buffer.from("edited in the app"));
    api.state.events.push({ notifications: [], files: [{ path: "/shared.md", nodeId: file.nodeId, version: file.version, at: new Date().toISOString(), by: "sam", mine: false }] });
    const copy = path.join(cwd, `shared.remote-v${file.version}.md`);
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, "watch"], { cwd, env: { ...cleanEnv(home), NETWORKBASE_API_URL: api.url, NETWORKBASE_TOKEN: "nb_pat_test" } });
      const stop = () => { clearInterval(poll); clearTimeout(timer); child.kill("SIGINT"); };
      const poll = setInterval(() => { if (fs.existsSync(copy)) stop(); }, 100);
      const timer = setTimeout(stop, 15_000);
      child.on("exit", resolve);
    });
    const contents = fs.readdirSync(cwd).filter((f) => f.startsWith("shared")).map((f) => local(f));
    assert.ok(contents.includes("my edit, not pushed"), "my edit is kept");
    assert.ok(contents.includes("edited in the app"), "the app's edit is kept");
  });
});

// Report C6: a large workspace (5,000 files, deep folders) stays within set limits for status, pull and push.
describe("5,000 files (C6)", () => {
  it("status, pull and push stay within their limits", { timeout: 240_000 }, async () => {
    const api = await startFakeServer();
    try {
      const cwd = await tempDir("nb-5k-");
      const home = await tempDir("nb-5k-home-");
      for (let i = 0; i < 5000; i++) putFile(api.state, `/a${i % 10}/b${i % 7}/c${i % 3}/f${i}.txt`, Buffer.from(`file ${i}`));
      await runCli(["init", "design-lab"], { api: api.url, cwd, home });
      const timed = async (/** @type {string[]} */ args) => { const t = Date.now(); const r = await runCli(args, { api: api.url, cwd, home, timeoutMs: 180_000 }); return { ms: Date.now() - t, r }; };
      const pull = await timed(["pull"]);
      assert.equal(pull.r.code, 0, pull.r.stderr);
      const status = await timed(["status", "--json"]);
      fs.writeFileSync(path.join(cwd, "a1", "b1", "c1", "f1.txt"), "changed");
      const push = await timed(["push", "a1/b1/c1/f1.txt"]);
      assert.equal(push.r.code, 0, push.r.stderr);
      // ponytail: limits sized for CI runners against the local fake server; the live check measures the real one.
      assert.ok(pull.ms < 120_000, `pull took ${pull.ms} ms`);
      assert.ok(status.ms < 15_000, `status took ${status.ms} ms`);
      assert.ok(push.ms < 15_000, `push took ${push.ms} ms`);
    } finally {
      api.close();
    }
  });
});
