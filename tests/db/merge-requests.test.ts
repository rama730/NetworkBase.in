import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part H, phase H-3 (M8): merge requests. Open one from a branch, review it (comments, suggestions, approve or
// request changes), post checks, merge or squash into main as one change set; the task moves; branch delete closes it.
const headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
const stored = new Map<string, Buffer>();
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); return { error: null }; },
    download: async (key: string) => (stored.has(key) ? { data: new Blob([stored.get(key)!]), error: null } : { data: null, error: new Error("not found") }),
    remove: async (keys: string[]) => { for (const k of keys) stored.delete(k); return { error: null }; },
    createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null }),
  }) } }),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
});
const sent: Array<{ kind: string; title: string; recipientUserId: string }> = [];
moduleStubs.set("@/lib/notifications/fanout", { enqueueNotificationFanout: async (e: { writes: Array<{ input: { kind: string; title: string; recipientUserId: string } }> }) => { for (const w of e.writes) sent.push(w.input); return { enqueued: e.writes.length }; } });

type Branches = typeof import("../../src/lib/domain/branches");
type Saves = typeof import("../../src/lib/domain/saves");
type Mrs = typeof import("../../src/lib/domain/merge-requests");
type Sets = typeof import("../../src/lib/domain/change-sets");
let sets: Sets;
let branches: Branches;
let saves: Saves;
let mrs: Mrs;
before(async () => {
  branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
  mrs = await loadAppModule(() => import("../../src/lib/domain/merge-requests"));
  sets = await loadAppModule(() => import("../../src/lib/domain/change-sets"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const actor = (id: string) => ({ user: { id } });
const request = () => new Request("https://app.test/x", { method: "POST" });

async function content(workspace: string, userId: string, text: string) {
  const bytes = Buffer.from(text);
  const key = `${workspace}/test/${sha(bytes)}-${randomUUID()}`;
  stored.set(key, bytes);
  const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', 'text/plain', ${bytes.byteLength}, ${sha(bytes)}, now(), now(), ${bytes.byteLength}, 'text/plain') RETURNING id`;
  return { key, assetId: asset!.id as string, hash: sha(bytes), size: bytes.byteLength };
}
async function addFile(workspace: string, userId: string, path: string, text: string) {
  const c = await content(workspace, userId, text);
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type)
    VALUES (${workspace}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, ${c.size}, 1, ${c.key}, ${c.assetId}, 'text/plain') RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId})`;
}
async function editMain(workspace: string, userId: string, path: string, text: string) {
  const [n] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  const c = await content(workspace, userId, text);
  const [{ v }] = await sql`SELECT coalesce(max(version), 0) + 1 AS v FROM file_versions WHERE node_id = ${n!.id}`;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${n!.id}, ${v}, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId})`;
    await tx`UPDATE workspace_nodes SET current_version = ${v}, s3_key = ${c.key}, asset_id = ${c.assetId}, size = ${c.size} WHERE id = ${n!.id}`;
  });
}
async function mainText(workspace: string, path: string) {
  const [n] = await sql`SELECT s3_key FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  return n ? stored.get(n.s3_key)?.toString() : undefined;
}
async function setup() {
  const owner = await sql.begin((tx) => createUser(tx));
  const dev = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, workspace, dev, "member"));
  await addFile(workspace, owner, "/README.md", "# Demo\n");
  await addFile(workspace, owner, "/src/a.ts", "a1\na2\na3\na4\na5\na6\n");
  await saves.setBranchesEnabled(actor(owner), workspace, true);
  const { branch } = await branches.createBranch(actor(dev), workspace, { name: "dev/feature" });
  return { owner, dev, workspace, branch };
}

test("open: refuses an empty branch; pre-filled title and saves; one open per branch; owners asked to review", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await assert.rejects(mrs.createMergeRequest(d, workspace, { source: branch.name }), { code: "MERGE_REQUEST_EMPTY" });
  await branches.saveTextOnBranch(d, branch.id, { path: "/src/a.ts", text: "a1\na2 fixed\na3\na4\na5\na6\n", expectedHash: sha("a1\na2\na3\na4\na5\na6\n"), message: "Fix a2" });
  sent.length = 0;
  const { mergeRequest: mr, saves: list, files } = await mrs.createMergeRequest(d, workspace, { source: branch.name });
  assert.equal(mr.number, 1);
  assert.equal(mr.title, "Feature");
  assert.match(mr.description, /- Fix a2/);
  assert.deepEqual(mr.reviewers.map((r) => [r.person.id, r.state]), [[owner, "requested"]]);
  assert.deepEqual(list.map((s) => s.message), ["Fix a2"]);
  assert.deepEqual(files?.files.map((f) => [f.path, f.op]), [["/src/a.ts", "change"]]);
  assert.deepEqual(sent.map((n) => [n.kind, n.recipientUserId]), [["merge_request", owner]]);
  await assert.rejects(mrs.createMergeRequest(d, workspace, { source: branch.name }), { code: "MERGE_REQUEST_EXISTS" });
  await assert.rejects(mrs.createMergeRequest(d, workspace, { source: branch.name, target: "other" }), { code: "NOT_AVAILABLE" });
  const listed = await mrs.listMergeRequests(actor(owner), workspace, { reviewRequested: true });
  assert.deepEqual(listed.mergeRequests.map((m) => [m.number, m.reviewRequested]), [[1, true]]);
  // Outsiders can't see it, whatever exists.
  const stranger = await sql.begin((tx) => createUser(tx));
  await assert.rejects(mrs.getMergeRequest(actor(stranger), workspace, 1), { code: "NOT_FOUND" });
});

test("review: no self-approval, no agents; an approval before a new save is marked; changes need a reason", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await branches.saveTextOnBranch(d, branch.id, { path: "/README.md", text: "# Demo 2\n", expectedHash: sha("# Demo\n") });
  await mrs.createMergeRequest(d, workspace, { source: branch.name, title: "Better readme" });
  await assert.rejects(mrs.reviewMergeRequest(d, workspace, 1, { state: "approve" }), { code: "SELF_REVIEW" });
  await assert.rejects(mrs.reviewMergeRequest({ user: { id: owner }, tokenKind: "agent" }, workspace, 1, { state: "approve" }), { code: "FORBIDDEN" });
  await assert.rejects(mrs.reviewMergeRequest(actor(owner), workspace, 1, { state: "request_changes" }), { code: "BAD_REQUEST" });
  let got = await mrs.reviewMergeRequest(actor(owner), workspace, "!1", { state: "approve", body: "Looks good" });
  assert.equal(got.mergeRequest.shownState, "approved");
  assert.equal(got.mergeRequest.reviewers[0]!.earlierSave, false);
  await branches.saveTextOnBranch(d, branch.id, { path: "/README.md", text: "# Demo 3\n", expectedHash: sha("# Demo 2\n") });
  got = await mrs.getMergeRequest(actor(owner), workspace, 1);
  assert.equal(got.mergeRequest.reviewers[0]!.earlierSave, true, "approved an earlier save");
  // A comment-only review keeps the approval.
  got = await mrs.reviewMergeRequest(actor(owner), workspace, 1, { state: "comment", body: "One more thought" });
  assert.equal(got.mergeRequest.reviewers[0]!.state, "approved");
  assert.deepEqual(got.comments.map((c) => c.reviewState), ["approved", "commented"]);
});

test("suggested edits: applied as a save on the branch; refused once the lines changed", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await branches.saveTextOnBranch(d, branch.id, { path: "/src/a.ts", text: "a1\na2\na3 new\na4\na5\na6\n", expectedHash: sha("a1\na2\na3\na4\na5\na6\n") });
  await mrs.createMergeRequest(d, workspace, { source: branch.name });
  const o = actor(owner);
  await assert.rejects(mrs.commentOnMergeRequest(o, workspace, 1, { suggestion: "x", path: "/src/a.ts" }), { code: "BAD_REQUEST" });
  const { comment: s1 } = await mrs.commentOnMergeRequest(o, workspace, 1, { body: "Name it better", path: "src/a.ts", line: 3, suggestion: "a3 renamed" });
  const { comment: s2 } = await mrs.commentOnMergeRequest(o, workspace, 1, { body: "And this", path: "/src/a.ts", line: 3, endLine: 4, suggestion: "a3+a4" });
  const { save } = await mrs.applySuggestion(d, workspace, 1, s1.id);
  assert.ok(save);
  assert.equal((await branches.branchFileText(d, branch.id, "/src/a.ts")).text, "a1\na2\na3 renamed\na4\na5\na6\n");
  await assert.rejects(mrs.applySuggestion(d, workspace, 1, s1.id), { code: "CONFLICT" });
  await assert.rejects(mrs.applySuggestion(d, workspace, 1, s2.id), { code: "CHANGE_SET_CONFLICT" }, "line 3 changed since");
  const got = await mrs.getMergeRequest(o, workspace, 1);
  assert.equal(got.comments.find((c) => c.id === s1.id)!.resolved, true);
  assert.equal(got.saves[0]!.message.startsWith("Applied a suggestion"), true);
});

test("merge: one save on main (kind merge), branch marked merged, task done, people told; squash names the save", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, status, task_number) VALUES (${workspace}, 'Fix a2', ${owner}, ${dev}, 'in_progress', 4) RETURNING id`;
  await branches.saveTextOnBranch(d, branch.id, { path: "/src/a.ts", text: "a1\na2 fixed\na3\na4\na5\na6\n", expectedHash: sha("a1\na2\na3\na4\na5\na6\n") });
  await branches.saveTextOnBranch(d, branch.id, { path: "/docs/new.md", text: "new\n", expectedHash: null });
  await branches.deleteOnBranch(d, branch.id, "/README.md");
  const { mergeRequest } = await mrs.createMergeRequest(d, workspace, { source: branch.name, description: "Closes #4", draft: true });
  assert.equal(mergeRequest.task?.id, task!.id);
  await assert.rejects(mrs.mergeMergeRequest(d, request(), workspace, 1, {}), { code: "DRAFT" });
  await mrs.updateMergeRequest(d, workspace, 1, { draft: false });
  // Main moved on another file meanwhile: no conflict.
  await editMain(workspace, owner, "/src/a.ts", "a1\na2\na3\na4\na5\na6 main\n");
  sent.length = 0;
  const done = await mrs.mergeMergeRequest(d, request(), workspace, 1, { method: "merge" });
  assert.equal(done.outcome, "merged");
  assert.equal(await mainText(workspace, "/src/a.ts"), "a1\na2 fixed\na3\na4\na5\na6 main\n", "both sides kept (G9)");
  assert.equal(await mainText(workspace, "/docs/new.md"), "new\n");
  assert.equal(await mainText(workspace, "/README.md"), undefined);
  const [s] = await sql`SELECT kind, message, second_parent_save_id FROM saves WHERE id = ${done.outcome === "merged" ? done.save!.id : ""}`;
  assert.deepEqual([s!.kind, s!.message], ["merge", "Merge !1: Fix a2"], "titled from the linked task");
  assert.ok(s!.second_parent_save_id);
  const [b] = await sql`SELECT status FROM branches WHERE id = ${branch.id}`;
  assert.equal(b!.status, "merged");
  const [t] = await sql`SELECT status FROM tasks WHERE id = ${task!.id}`;
  assert.equal(t!.status, "done");
  assert.ok(sent.some((n) => n.recipientUserId === owner && /merged !1/.test(n.title)));
  const got = await mrs.getMergeRequest(actor(owner), workspace, 1);
  assert.equal(got.mergeRequest.state, "merged");
  await assert.rejects(mrs.mergeMergeRequest(d, request(), workspace, 1, {}), { code: "MERGE_REQUEST_CLOSED" });
  // Squash: one save named after the merge request.
  const { branch: b2 } = await branches.createBranch(d, workspace, { name: "dev/two" });
  await branches.saveTextOnBranch(d, b2.id, { path: "/docs/two.md", text: "two\n", expectedHash: null });
  await mrs.createMergeRequest(d, workspace, { source: b2.name, title: "Add two" });
  const sq = await mrs.mergeMergeRequest(actor(owner), request(), workspace, 2, { method: "squash" });
  const [s2] = await sql`SELECT kind, message, second_parent_save_id FROM saves WHERE id = ${sq.outcome === "merged" ? sq.save!.id : ""}`;
  assert.deepEqual([s2!.kind, s2!.message, s2!.second_parent_save_id], ["squash", "Add two", null]);
});

test("merge conflicts come back without changing main; update from main settles them, then it merges", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await branches.saveTextOnBranch(d, branch.id, { path: "/src/a.ts", text: "a1\nBRANCH\na3\na4\na5\na6\n", expectedHash: sha("a1\na2\na3\na4\na5\na6\n") });
  await mrs.createMergeRequest(d, workspace, { source: branch.name });
  await editMain(workspace, owner, "/src/a.ts", "a1\nMAIN\na3\na4\na5\na6\n");
  const got = await mrs.getMergeRequest(d, workspace, 1);
  assert.deepEqual([got.mergeRequest.behind, got.mergeRequest.bothChanged], [1, ["/src/a.ts"]]);
  const res = await mrs.mergeMergeRequest(d, request(), workspace, 1, {});
  assert.equal(res.outcome, "conflicts");
  assert.equal(await mainText(workspace, "/src/a.ts"), "a1\nMAIN\na3\na4\na5\na6\n");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM change_sets WHERE workspace_id = ${workspace} AND status IN ('open', 'ready')`;
  assert.equal(n, 0, "the conflicted set isn't left behind");
  await branches.updateFromMain(d, branch.id, { resolutions: { "/src/a.ts": "branch" } });
  const merged = await mrs.mergeMergeRequest(d, request(), workspace, 1, {});
  assert.equal(merged.outcome, "merged");
  assert.equal(await mainText(workspace, "/src/a.ts"), "a1\nBRANCH\na3\na4\na5\na6\n");
});

test("checks are tied to the head save; failed ones notify; deleting the branch closes it and restoring reopens", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await branches.saveTextOnBranch(d, branch.id, { path: "/docs/x.md", text: "x\n", expectedHash: null });
  await mrs.createMergeRequest(d, workspace, { source: branch.name });
  await assert.rejects(mrs.postCheck(d, workspace, 1, { name: "build", state: "passed", url: "http://insecure" }), { code: "BAD_REQUEST" });
  await mrs.postCheck(d, workspace, 1, { name: "build", state: "running" });
  sent.length = 0;
  await mrs.postCheck(actor(owner), workspace, 1, { name: "build", state: "failed", url: "https://ci.example/1" });
  assert.ok(sent.some((n) => n.recipientUserId === dev && /Checks failed/.test(n.title)));
  let got = await mrs.getMergeRequest(d, workspace, 1);
  assert.deepEqual(got.mergeRequest.checks.map((c) => [c.name, c.state]), [["build", "failed"]]);
  await branches.saveTextOnBranch(d, branch.id, { path: "/docs/x.md", text: "x2\n", expectedHash: sha("x\n") });
  got = await mrs.getMergeRequest(d, workspace, 1);
  assert.deepEqual(got.mergeRequest.checks, [], "a new save has no checks yet");
  await branches.deleteBranch(d, branch.id);
  got = await mrs.getMergeRequest(d, workspace, 1);
  assert.equal(got.mergeRequest.state, "closed");
  assert.deepEqual(got.events.map((e) => [e.kind, (e.data as { reason?: string }).reason ?? null]).at(-1), ["closed", "branch_deleted"]);
  await branches.restoreBranch(d, branch.id);
  got = await mrs.getMergeRequest(d, workspace, 1);
  assert.equal(got.mergeRequest.state, "open");
  // Close and reopen by hand; readers can comment but not close.
  const viewer = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, workspace, viewer, "viewer"));
  await mrs.commentOnMergeRequest(actor(viewer), workspace, 1, { body: "Nice" });
  await assert.rejects(mrs.updateMergeRequest(actor(viewer), workspace, 1, { state: "closed" }), { code: "FORBIDDEN" });
  got = await mrs.updateMergeRequest(d, workspace, 1, { state: "closed" });
  assert.equal(got.mergeRequest.state, "closed");
  got = await mrs.updateMergeRequest(d, workspace, 1, { state: "open" });
  assert.equal(got.mergeRequest.state, "open");
});

test("a merge held for someone else's yes isn't reused by another person: they get a fresh one and it merges", async () => {
  const { owner, dev, workspace, branch } = await setup();
  const d = actor(dev);
  await branches.saveTextOnBranch(d, branch.id, { path: "/docs/held.md", text: "held\n", expectedHash: null });
  await mrs.createMergeRequest(d, workspace, { source: branch.name });
  const held = await sets.startChangeSet(actor(owner), { workspaceId: workspace, title: "held merge" });
  const [{ head }] = await sql`SELECT head_save_id AS head FROM branches WHERE id = ${branch.id}`;
  await sql`UPDATE merge_requests SET pending_change_set_id = ${held.id}, pending_head_save_id = ${head} WHERE workspace_id = ${workspace} AND number = 1`;
  const done = await mrs.mergeMergeRequest(d, request(), workspace, 1, {});
  assert.equal(done.outcome, "merged");
  assert.equal(done.outcome === "merged" && done.branchMoved, false);
  assert.equal(await mainText(workspace, "/docs/held.md"), "held\n");
  const [{ status }] = await sql`SELECT status FROM change_sets WHERE id = ${held.id}`;
  assert.equal(status, "discarded");
});
