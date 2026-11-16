import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createApi } from "../lib/api.mjs";
import { currentChange, readJournal } from "../lib/changes/capture.mjs";
import { startCapture } from "../lib/changes/watch.mjs";
import { putFile, startFakeServer, TOKEN, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report G7, G8 (M5): saved files become one change set; only what changed is sent, only missing content uploaded;
// finish checks it, apply lands it, and the folder is clean afterwards.
async function linked(api) {
  for (const [p, t] of [["/a.txt", "a one\n"], ["/b.txt", "b one\n"], ["/c.txt", "c one\n"], ["/d.txt", "d one\n"]]) putFile(api.state, p, Buffer.from(t));
  const cwd = await tempDir("nb-change-");
  const home = await tempDir("nb-change-h-");
  await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  const pulled = await runCli(["pull"], { api: api.url, cwd, home });
  assert.equal(pulled.code, 0, pulled.stderr);
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  return { cwd, home, nb };
}

describe("nb change (G7, G8)", () => {
  it("captures changes, adds, deletes and renames; finish, apply, and the folder is in step after", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      const started = await nb(["change", "start", "Redesign sign-in", "--json"]);
      assert.equal(started.code, 0, started.stderr);
      const id = JSON.parse(started.stdout).data.changeSet.id;
      fs.writeFileSync(path.join(cwd, "b.txt"), "b two\n");
      fs.writeFileSync(path.join(cwd, "new.txt"), "brand new\n");
      fs.rmSync(path.join(cwd, "c.txt"));
      fs.mkdirSync(path.join(cwd, "moved"));
      fs.renameSync(path.join(cwd, "d.txt"), path.join(cwd, "moved", "d.txt"));
      const status = await nb(["change", "status", "--json"]);
      assert.equal(status.code, 0, status.stderr);
      const items = JSON.parse(status.stdout).data.items.map((/** @type {any} */ i) => [i.op, i.path, i.fromPath ?? null]).sort();
      assert.deepEqual(items, [["add", "/new.txt", null], ["change", "/b.txt", null], ["delete", "/c.txt", null], ["rename", "/moved/d.txt", "/d.txt"]]);
      // The delete makes it big: --yes is the person's answer here.
      const applied = await nb(["change", "apply", "--yes", "--json"]);
      assert.equal(applied.code, 0, applied.stderr);
      assert.equal(JSON.parse(applied.stdout).data.changeSet.status, "applied");
      assert.equal(api.state.files.get("/b.txt")?.content.toString(), "b two\n");
      assert.ok(api.state.files.has("/moved/d.txt") && !api.state.files.has("/d.txt") && !api.state.files.has("/c.txt"));
      assert.equal(currentChange(cwd), null, "the folder's change set is closed");
      const clean = await nb(["status", "--json"]);
      const changed = JSON.parse(clean.stdout).data.files?.filter((/** @type {any} */ f) => f.state !== "unchanged") ?? [];
      assert.deepEqual(changed, [], "nothing left to push after the apply");
      assert.ok(id);
    } finally { await api.close(); }
  });

  it("sends only what changed since the last sync, and never uploads content the server has", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Copy"]);
      fs.writeFileSync(path.join(cwd, "copy-of-a.txt"), "a one\n");
      await nb(["change", "status"]);
      const contentCalls = api.requests.filter((r) => r.path.endsWith("/content")).length;
      assert.equal(contentCalls, 0, "a's content is already on the server");
      const calls = /** @type {any} */ (api.state).itemCalls;
      await nb(["change", "status"]);
      assert.equal(/** @type {any} */ (api.state).itemCalls, calls, "nothing new: no item call");
      fs.writeFileSync(path.join(cwd, "copy-of-a.txt"), "a one\n"); // saved again, same content
      await nb(["change", "status"]);
      assert.equal(/** @type {any} */ (api.state).itemCalls, calls);
    } finally { await api.close(); }
  });

  it("a lost connection during upload resumes from the journal", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      const started = JSON.parse((await nb(["change", "start", "Flaky", "--json"])).stdout).data.changeSet.id;
      fs.writeFileSync(path.join(cwd, "a.txt"), "a changed\n");
      api.setFault(`/api/v1/change-sets/${started}/content`, "503");
      const failed = await nb(["change", "status"]);
      assert.notEqual(failed.code, 0);
      assert.equal(readJournal(cwd, started).missing.length, 1, "the journal remembers what's still to upload");
      api.setFault(`/api/v1/change-sets/${started}/content`, null);
      const finished = await nb(["change", "finish", "--json"]);
      assert.equal(finished.code, 0, finished.stderr);
      assert.equal(readJournal(cwd, started).missing.length, 0);
    } finally { await api.close(); }
  });

  it("a file that looks like it holds a key isn't sent until the person confirms", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Config"]);
      fs.writeFileSync(path.join(cwd, "keys.txt"), "AKIAIOSFODNN7EXAMPLE\n");
      const status = await nb(["change", "status"]);
      assert.match(status.stdout, /Not sent, it looks like it holds a key: \/keys\.txt/);
      const held = await nb(["change", "finish"]);
      assert.equal(held.code, 5);
      assert.match(held.stderr, /looks like it holds a password or key/);
      const ok = await nb(["change", "finish", "--confirm-secrets", "--json"]);
      assert.equal(ok.code, 0, ok.stderr);
    } finally { await api.close(); }
  });

  it("an agent's big change set never applies without its person's yes", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Cleanup"]);
      fs.rmSync(path.join(cwd, "a.txt"));
      await nb(["change", "finish"]);
      const applies = () => api.requests.filter((r) => r.path.endsWith("/apply"));
      await nb(["change", "apply", "--yes"]);
      assert.ok(applies().every((r) => !r.body?.confirmToken), "the finish's confirm token is never sent by itself");
    } finally { await api.close(); }
  });

  it("nb watch --change needs an open change set; workspaces without change sets say so", async () => {
    const api = await startFakeServer();
    try {
      const { nb } = await linked(api);
      const w = await nb(["watch", "--change"]);
      assert.equal(w.code, 1);
      assert.match(w.stderr, /nb change start/);
      /** @type {any} */ (api.state).changeSetsOff = true;
      const off = await nb(["change", "start", "x"]);
      assert.equal(off.code, 3);
      assert.match(off.stderr, /aren't turned on/);
    } finally { await api.close(); }
  });

  it("live capture: the first save opens a change set named after the task; a burst of 400 files is one rescan", async () => {
    const api = await startFakeServer();
    try {
      const { cwd } = await linked(api);
      const client = createApi({ origin: api.url, token: TOKEN, version: "2.2.0" });
      const capture = startCapture({ api: client, root: cwd, project: { workspaceId: WORKSPACE_ID, remoteRoot: "/" }, autoTitle: () => "Work on #4: Login bug" });
      try {
        for (let i = 0; i < 400; i += 1) fs.writeFileSync(path.join(cwd, `gen-${String(i).padStart(3, "0")}.txt`), `file ${i}\n`);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && !(/** @type {any} */ (api.state).changeSets?.size && [.../** @type {any} */ (api.state).changeSets.values()][0].items.size === 400)) await new Promise((r) => setTimeout(r, 200));
        const [cs] = [.../** @type {any} */ (api.state).changeSets.values()];
        assert.equal(cs.title, "Work on #4: Login bug");
        assert.equal(cs.items.size, 400);
        assert.equal(/** @type {any} */ (api.state).itemCalls, 2, "400 items in two calls of 200, after one rescan");
      } finally { capture.stop(); }
    } finally { await api.close(); }
  });
});
