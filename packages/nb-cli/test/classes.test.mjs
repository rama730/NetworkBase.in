import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A8.4–A8.5: a student lists, views, pulls and hands in; a reviewer lists, pulls, approves and returns.
describe("nb assignment and nb review", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  const nb = (/** @type {string[]} */ args) => runCli(args, { api: api.url, cwd, home });
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-class-");
    home = await tempDir("nb-class-home-");
    await nb(["init", "design-lab"]);
    api.state.assignments.push(
      { id: "aaaaaaaa-0000-4000-8000-000000000001", number: 3, title: "Essay on motion", due: new Date(Date.now() + 86_400_000).toISOString(), state: "in_progress", submissionType: "file", aiPolicy: "not_allowed", aiNote: "Write it yourself." },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", number: 4, title: "Lab link", due: null, state: "not_started", submissionType: "link", aiPolicy: "labelled", late: true },
    );
  });
  after(() => api.close());

  it("lists and views with the AI policy and the late rule", async () => {
    const list = await nb(["assignment", "list", "--json"]);
    assert.equal(JSON.parse(list.stdout).data.copies.length, 2);
    const v = await nb(["assignment", "view", "3"]);
    assert.equal(v.code, 0, v.stderr);
    assert.match(v.stdout, /No AI agents: Write it yourself\./);
    assert.match(v.stdout, /Late work accepted/);
    assert.match(v.stdout, /Write 500 words\./);
  });

  it("hands in files as final on the copy, then submits; a link assignment needs --link", async () => {
    fs.writeFileSync(path.join(cwd, "essay.pdf"), "pdf");
    const r = await nb(["assignment", "hand-in", "3", "essay.pdf", "-m", "Final draft"]);
    assert.equal(r.code, 0, r.stderr);
    const placed = api.requests.filter((q) => q.path === "/api/v1/files/place").at(-1);
    assert.equal(placed?.body.taskId, "aaaaaaaa-0000-4000-8000-000000000001");
    assert.equal(placed?.body.role, "final");
    assert.equal(api.state.assignments[0].handIn.note, "Final draft");
    const noLink = await nb(["assignment", "hand-in", "4"]);
    assert.equal(noLink.code, 2);
    assert.match(noLink.stderr, /takes a link/);
    const late = await nb(["assignment", "hand-in", "4", "--link", "https://example.com/x"]);
    assert.equal(late.code, 7, "late needs a yes; not a terminal → exit 7");
    const yes = await nb(["assignment", "hand-in", "4", "--link", "https://example.com/x", "--yes"]);
    assert.equal(yes.code, 0, yes.stderr);
  });

  it("takes a hand-in back before it's approved; with nothing handed in it says so", async () => {
    const a = api.state.assignments[0];
    Object.assign(a, { state: "submitted" });
    const r = await nb(["assignment", "unsubmit", String(a.number)]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Took back .* back to In progress/);
    assert.equal(a.state, "in_progress");
    const again = await nb(["assignment", "unsubmit", String(a.number)]);
    assert.notEqual(again.code, 0);
    assert.match(again.stderr, /no hand-in to take back/i);
    Object.assign(a, { state: "submitted" }); // the review test below picks it up as handed in
  });

  it("a reviewer pulls read-only, returns with a reason, and approves", async () => {
    putFile(api.state, "/hand-in/essay.pdf", Buffer.from("pdf"));
    const list = await nb(["review", "list", "--json"]);
    assert.equal(JSON.parse(list.stdout).data.rows.length, 2);
    const pull = await nb(["review", "pull", "1"]);
    assert.equal(pull.code, 0, pull.stderr);
    const file = path.join(cwd, "reviews", "essay-on-motion", "sam-lee", "essay.pdf");
    assert.equal(fs.readFileSync(file, "utf8"), "pdf");
    assert.equal(fs.statSync(file).mode & 0o222, 0, "read-only");
    const noReason = await nb(["review", "return", "1"]);
    assert.equal(noReason.code, 2);
    assert.equal((await nb(["review", "return", "1", "-m", "Cite your sources"])).code, 0);
    assert.deepEqual(api.state.assignments[0].review, { decision: "return", reason: "Cite your sources" });
    assert.equal((await nb(["review", "approve", "1"])).code, 0);
    assert.equal(api.state.assignments[1].state, "done");
  });
});
