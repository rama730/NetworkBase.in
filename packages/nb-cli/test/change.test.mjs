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

  it("a small change set finished earlier applies without asking (M5 live check)", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Small"]);
      fs.writeFileSync(path.join(cwd, "a.txt"), "a two\n");
      assert.equal((await nb(["change", "finish"])).code, 0);
      const r = await nb(["change", "apply"]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(api.state.files.get("/a.txt")?.content.toString(), "a two\n");
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

  it("nb change update merges a teammate's edit into your file; the same lines get a conflict copy and resolve", async () => {
    const api = await startFakeServer();
    try {
      const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
      putFile(api.state, "/m.txt", Buffer.from(ten));
      putFile(api.state, "/c.txt", Buffer.from(ten));
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Merge"]);
      fs.writeFileSync(path.join(cwd, "m.txt"), ten.replace("line 9", "mine 9"));
      fs.writeFileSync(path.join(cwd, "c.txt"), ten.replace("line 3", "mine 3"));
      putFile(api.state, "/m.txt", Buffer.from(ten.replace("line 2", "theirs 2")));
      putFile(api.state, "/c.txt", Buffer.from(ten.replace("line 3", "theirs 3")));
      const up = await nb(["change", "update", "--json"]);
      assert.equal(up.code, 4, up.stderr);
      const data = JSON.parse(up.stdout).data;
      assert.deepEqual(data.merged, ["/m.txt"]);
      assert.equal(fs.readFileSync(path.join(cwd, "m.txt"), "utf8"), ten.replace("line 2", "theirs 2").replace("line 9", "mine 9"));
      assert.equal(data.conflicts[0].path, "/c.txt");
      assert.ok(fs.existsSync(path.join(cwd, data.conflicts[0].copy)), "theirs is next to yours");
      const res = await nb(["change", "resolve", "c.txt", "--mine"]);
      assert.equal(res.code, 0, res.stderr);
      assert.ok(!fs.existsSync(path.join(cwd, data.conflicts[0].copy)));
      const status = JSON.parse((await nb(["change", "status", "--json"])).stdout).data;
      const c = status.items.find((/** @type {any} */ i) => i.path === "/c.txt");
      assert.equal(c.baseVersion, api.state.files.get("/c.txt")?.version, "yours now goes over their version");
    } finally { await api.close(); }
  });

  it("a push bigger than one upload call goes up as one change set (G17); small pushes don't change", async () => {
    const api = await startFakeServer();
    try {
      for (let i = 0; i < 60; i += 1) putFile(api.state, `/p${i}.txt`, Buffer.from(`one ${i}\n`));
      const { cwd, nb } = await linked(api);
      for (let i = 0; i < 60; i += 1) fs.writeFileSync(path.join(cwd, `p${i}.txt`), `two ${i}\n`);
      const r = await nb(["push", "--all", "--no-task", "--yes", "--json"]);
      assert.equal(r.code, 0, r.stderr);
      const data = JSON.parse(r.stdout).data;
      assert.equal(data.files.length, 60);
      assert.ok(data.changeSet?.id, "one change set");
      assert.equal(api.requests.filter((q) => q.path === "/api/v1/files/place").length, 0, "no batch-by-batch upload");
      fs.writeFileSync(path.join(cwd, "small.txt"), "small\n");
      const small = await nb(["push", "small.txt", "--no-task", "--json"]);
      assert.equal(small.code, 0, small.stderr);
      assert.equal(api.requests.filter((q) => q.path === "/api/v1/files/place").length, 1, "a small push is unchanged");
    } finally { await api.close(); }
  });

  it("sign-in expires mid-work: capture keeps the journal, and after signing in again it carries on (G20)", async () => {
    const api = await startFakeServer();
    try {
      const { cwd, nb } = await linked(api);
      const id = JSON.parse((await nb(["change", "start", "Expiring", "--json"])).stdout).data.changeSet.id;
      /** @type {string[]} */ const lines = [];
      const capture = startCapture({ api: createApi({ origin: api.url, token: TOKEN, version: "2.2.0" }), root: cwd, project: { workspaceId: WORKSPACE_ID, remoteRoot: "/" }, log: (l) => lines.push(l) });
      try {
        api.setFault(`/api/v1/change-sets/${id}/items`, "401");
        fs.writeFileSync(path.join(cwd, "a.txt"), "edited while signed out\n");
        await capture.flush();
        assert.match(lines.join("\n"), /sign-in expired/i);
        assert.equal(fs.readFileSync(path.join(cwd, "a.txt"), "utf8"), "edited while signed out\n", "the edit stays here");
        api.setFault(`/api/v1/change-sets/${id}/items`, null);
        await capture.flush();
        const cs = /** @type {any} */ (api.state).changeSets.get(id);
        assert.ok(cs.items.has("/a.txt"), "sent once signed in again");
      } finally { capture.stop(); }
    } finally { await api.close(); }
  });

  it("a case-only rename (Login.tsx → login.tsx) is one rename, not a delete and an add (G21)", async () => {
    const api = await startFakeServer();
    try {
      putFile(api.state, "/Login.tsx", Buffer.from("export default 1\n"));
      const { cwd, nb } = await linked(api);
      await nb(["change", "start", "Case"]);
      fs.renameSync(path.join(cwd, "Login.tsx"), path.join(cwd, "login-tmp.tsx"));
      fs.renameSync(path.join(cwd, "login-tmp.tsx"), path.join(cwd, "login.tsx"));
      const items = JSON.parse((await nb(["change", "status", "--json"])).stdout).data.items;
      assert.deepEqual(items.map((/** @type {any} */ i) => [i.op, i.path, i.fromPath ?? null]), [["rename", "/login.tsx", "/Login.tsx"]]);
      assert.equal((await nb(["change", "apply", "--yes"])).code, 0);
      assert.ok(api.state.files.has("/login.tsx") && !api.state.files.has("/Login.tsx"));
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
