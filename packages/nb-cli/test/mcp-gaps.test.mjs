import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addTask, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";
import { startMcp } from "./helpers/mcp-session.mjs";

// Report D11, D12, D15 (M4c): classes, reviews, the inbox, questions, updates, subtasks and the M4b commands become
// tools in packs, each with its yes rule; messages to others always wait for a yes; no tool removes members.
describe("closing the gaps (D11, D12, D15)", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {Awaited<ReturnType<typeof startMcp>>} */
  let mcp;
  before(async () => {
    api = await startFakeServer();
    const cwd = await tempDir("nb-gaps-");
    const home = await tempDir("nb-gaps-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    api.state.assignments.push(
      { id: "aaaaaaaa-0000-4000-8000-000000000001", number: 3, title: "Essay on motion", due: null, state: "in_progress", submissionType: "file", aiPolicy: "not_allowed", aiNote: "Write it yourself." },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", number: 4, title: "Lab notes", due: null, state: "in_progress", submissionType: "text", aiPolicy: "allowed" },
    );
    mcp = await startMcp({ api: api.url, cwd, home });
  });
  after(async () => { await mcp.close(); await api.close(); });

  const names = async () => (await mcp.request("tools/list")).result.tools.map((/** @type {any} */ t) => t.name);

  it("each pack brings its tools; nothing removes members", async () => {
    for (const pack of ["classes", "people", "planning", "files"]) await mcp.call("networkbase_more_tools", { pack });
    const all = await names();
    for (const t of ["networkbase_assignment_list", "networkbase_assignment_view", "networkbase_assignment_hand_in", "networkbase_assignment_unsubmit", "networkbase_assignment_question",
      "networkbase_review_list", "networkbase_review_approve", "networkbase_review_return",
      "networkbase_inbox", "networkbase_inbox_reply", "networkbase_question_answer", "networkbase_update_list", "networkbase_update_post", "networkbase_update_comment", "networkbase_member_invite", "networkbase_member_role",
      "networkbase_task_tags", "networkbase_task_remind", "networkbase_subtask_edit", "networkbase_subtask_delete",
      "networkbase_trash", "networkbase_file_restore", "networkbase_folder_create", "networkbase_file_copy", "networkbase_file_star"]) assert.ok(all.includes(t), t);
    assert.ok(!all.some((n) => /member_remove|remove_member/.test(n)), "never: removing members");
  });

  it("a Not allowed assignment says the agent can't help and won't hand in", async () => {
    const view = await mcp.call("networkbase_assignment_view", { assignment: "3" });
    assert.match(view.content[0].text, /AI agents aren't allowed on this assignment: Write it yourself\. Tell the person you can't help with it/);
    const hand = await mcp.call("networkbase_assignment_hand_in", { assignment: "3", text: "done" });
    assert.equal(hand.structuredContent.error?.code, "AGENT_NOT_ALLOWED", hand.content[0].text);
    const ok = await mcp.call("networkbase_assignment_hand_in", { assignment: "4", text: "notes" });
    assert.equal(ok.structuredContent.status, "needs_confirmation", "handing in waits for a yes");
  });

  it("messages to others wait for a yes: update posts, update comments, mention comments, inbox replies", async () => {
    const post = await mcp.call("networkbase_update_post", { text: "Shipped the logo" });
    assert.equal(post.structuredContent.status, "needs_confirmation");
    assert.match(post.structuredContent.summary, /Post an update everyone in the workspace sees/);
    const t = addTask(api.state, { title: "Logo" });
    const mention = await mcp.call("networkbase_comment_add", { task: String(t.taskNumber), text: "@sam please look" });
    assert.equal(mention.structuredContent.status, "needs_confirmation");
    assert.match(mention.structuredContent.summary, /tells @sam/);
    const plain = await mcp.call("networkbase_comment_add", { task: String(t.taskNumber), text: "API is ready" });
    assert.equal(plain.structuredContent.status, "ok", "a comment that tells no one runs at once");
  });

  it("small things run at once: labels, watch, a reminder, a folder", async () => {
    const t = addTask(api.state, { title: "Hero" });
    const tags = await mcp.call("networkbase_task_tags", { task: String(t.taskNumber), addLabels: ["bug"], watch: true });
    assert.equal(tags.structuredContent.status, "ok", tags.content[0].text);
    const remind = await mcp.call("networkbase_task_remind", { task: String(t.taskNumber), when: "tomorrow 9am" });
    assert.equal(remind.structuredContent.status, "ok", remind.content[0].text);
    const folder = await mcp.call("networkbase_folder_create", { name: "design" });
    assert.equal(folder.structuredContent.status, "ok", folder.content[0].text);
  });

  it("people in words: a full name finds them; a part that fits several asks which (D2)", async () => {
    const t = addTask(api.state, { title: "Banner" });
    const full = await mcp.call("networkbase_task_assign", { task: String(t.taskNumber), to: "sam lee" });
    assert.notEqual(full.structuredContent.status, "error", full.content[0].text);
    const vague = await mcp.call("networkbase_task_assign", { task: String(t.taskNumber), to: "s" });
    assert.equal(vague.structuredContent.status, "needs_input", vague.content[0].text);
    assert.deepEqual(vague.structuredContent.questions[0].options.map((/** @type {any} */ o) => o.value).sort(), ["@sam", "@tester"]);
  });

  it("the session still starts under 4,000 tokens", async () => {
    const fresh = await startMcp({ api: api.url, cwd: await tempDir("nb-gaps-2-") });
    try {
      const { tools } = (await fresh.request("tools/list")).result;
      assert.ok(JSON.stringify(tools).length / 4 < 4000);
    } finally { await fresh.close(); }
  });
});
