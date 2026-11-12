import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C4 (M4b): comments (reply, edit, delete, @mentions, docs), inbox settings and mute, members, updates, reviews.
describe("working together (C4)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c4-");
    home = await tempDir("nb-c4-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });

  it("@names become mentions; reply, edit and delete your own comment", async () => {
    const t = addTask(api.state, { title: "Logo" });
    assert.equal((await nb(["comment", "add", "-m", "@sam please look", "--task", "1"])).code, 0);
    assert.match(t.comments[0].content, /^@\{bbbbbbbb-2222-4222-8222-222222222222\|Sam Lee\} please look$/);
    const nobody = await nb(["comment", "add", "-m", "@ghost hi", "--task", "1"]);
    assert.match(nobody.stderr, /@ghost isn't in this workspace/);
    const id = String(t.comments[0].id).slice(0, 8);
    assert.match((await nb(["comment", "list", "--task", "1"])).stdout, new RegExp(id));
    assert.match((await nb(["comment", "add", "--reply", id, "-m", "on it", "--task", "1"])).stdout, /Replied on #1/);
    assert.equal(t.comments[1].replyTo, t.comments[0].id);
    assert.match((await nb(["comment", "edit", id, "-m", "@sam please look again", "--task", "1"])).stdout, /Edited your comment/);
    assert.match(t.comments[0].content, /please look again/);
    assert.match((await nb(["comment", "delete", id, "--task", "1", "--yes"])).stdout, /Deleted your comment/);
    assert.equal(t.comments.length, 1);
  });

  it("nb comment add <task> <text>, and a full comment id needs no --task (M4b live check)", async () => {
    const t = addTask(api.state, { title: "Hero" });
    const added = await nb(["comment", "add", String(t.taskNumber), "looks", "good"]);
    assert.equal(added.code, 0, added.stderr);
    assert.equal(t.comments.at(-1).content, "looks good");
    const edited = await nb(["comment", "edit", String(t.comments.at(-1).id), "-m", "looks great"]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.equal(t.comments.at(-1).content, "looks great");
  });

  it("inbox settings and mute change only what's named", async () => {
    const r = await nb(["inbox", "settings", "--off", "projects", "--quiet", "22:00-08:00"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /projects +off/);
    assert.match(r.stdout, /quiet hours +22:00–08:00/);
    assert.equal(api.state.prefs.mentions, true);
    assert.equal((await nb(["inbox", "settings", "--off", "everything"])).code, 2);
    const noisy = `#${addTask(api.state, { title: "Noisy" }).taskNumber}`;
    assert.match((await nb(["inbox", "mute", noisy])).stdout, new RegExp(`Muted ${noisy} Noisy`));
    assert.equal(api.state.prefs.mutedScopes.length, 1);
    await nb(["inbox", "mute", noisy, "--off"]);
    assert.equal(api.state.prefs.mutedScopes.length, 0);
  });

  it("members: invite into an open role, change a role, remove, leave", async () => {
    assert.match((await nb(["member", "invite", "@sam", "--role", "Designer"])).stdout, /Invited @sam as Designer/);
    assert.match((await nb(["member", "invite", "@sam", "--role", "Chef"])).stderr, /Open roles: Designer/);
    assert.match((await nb(["member", "role", "@sam", "admin"])).stdout, /@sam is now admin/);
    assert.equal((await nb(["member", "remove", "@sam"])).code, 7, "asks first");
    assert.match((await nb(["member", "remove", "@sam", "--yes"])).stdout, /Removed @sam/);
    assert.match((await nb(["workspace", "leave", "--yes"])).stdout, /You left the workspace/);
    assert.deepEqual(api.state.memberOps?.map((o) => o.op), ["role", "remove", "leave"]);
  });

  it("updates: list, like, comment, view", async () => {
    api.state.feed = [{ id: "eeeeeeee-0000-4000-8000-000000000001", authorUsername: "sam", createdAt: new Date().toISOString(), content: "Shipped the logo", likeCount: 0, commentCount: 0, likedByViewer: false }];
    assert.match((await nb(["update", "list"])).stdout, /@sam .*Shipped the logo/s);
    assert.match((await nb(["update", "like", "1"])).stdout, /Liked the update/);
    assert.match((await nb(["update", "comment", "1", "-m", "nice"])).stdout, /Commented on the update/);
    assert.match((await nb(["update", "view", "1"])).stdout, /@tester: nice/);
  });

  it("reviews: approve several at once; diff since the last hand-in", async () => {
    api.state.assignments.push(
      { id: "aaaa0000-0000-4000-8000-000000000001", number: 1, title: "Essay", due: null, state: "submitted", submissionType: "files", aiPolicy: "allowed" },
      { id: "aaaa0000-0000-4000-8000-000000000002", number: 2, title: "Lab", due: null, state: "submitted", submissionType: "files", aiPolicy: "allowed" },
    );
    const r = await nb(["review", "approve", "1", "2", "-w", "design-lab"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal((r.stdout.match(/Approved/g) ?? []).length, 2);
    api.state.assignments.push({ id: "aaaa0000-0000-4000-8000-000000000003", number: 3, title: "Report", due: null, state: "submitted", submissionType: "files", aiPolicy: "allowed",
      versions: [{ version: 1, at: "", files: [{ nodeId: "n1", name: "a.md", size: 1 }, { nodeId: "n2", name: "b.md", size: 1 }] }, { version: 2, at: "", files: [{ nodeId: "n1", name: "a.md", size: 5 }, { nodeId: "n3", name: "c.md", size: 1 }] }] });
    const rows = JSON.parse((await nb(["review", "list", "-w", "design-lab", "--json"])).stdout).data.rows;
    const n = String(rows.findIndex((/** @type {any} */ x) => x.title === "Report") + 1);
    const d = await nb(["review", "diff", n, "-w", "design-lab"]);
    assert.match(d.stdout, /v1 → v2/);
    assert.match(d.stdout, /\+ c\.md added/);
    assert.match(d.stdout, /- b\.md removed/);
    assert.match(d.stdout, /~ a\.md changed/);
  });
});
