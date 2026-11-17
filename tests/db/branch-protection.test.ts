import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part H, phase H-4 (M8): protecting main. The database refuses any save on a protected main that isn't a merge
// (0099 saves_guard); merges need what the rules ask (approvals, checks, who merges), or an owner's override; agents
// work on branches. docs/superpowers/plans/2026-11-17-m8-h4-protection-agents.md
const headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null, entries: () => [][Symbol.iterator]() }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
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
moduleStubs.set("@/lib/notifications/fanout", { enqueueNotificationFanout: async () => ({ enqueued: 0 }) });

type Branches = typeof import("../../src/lib/domain/branches");
type Saves = typeof import("../../src/lib/domain/saves");
type Mrs = typeof import("../../src/lib/domain/merge-requests");
type Protect = typeof import("../../src/lib/domain/branch-protection");
let branches: Branches;
let saves: Saves;
let mrs: Mrs;
let protect: Protect;
before(async () => {
  branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
  mrs = await loadAppModule(() => import("../../src/lib/domain/merge-requests"));
  protect = await loadAppModule(() => import("../../src/lib/domain/branch-protection"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const actor = (id: string) => ({ user: { id } });
const agent = (id: string) => ({ user: { id }, tokenKind: "agent" as const, tokenScopes: new Set(["file:write", "file:read"]) });
const request = () => new Request("https://app.test/x", { method: "POST" });

async function addFile(workspace: string, userId: string, path: string, text: string) {
  const bytes = Buffer.from(text);
  const key = `${workspace}/test/${sha(bytes)}-${randomUUID()}`;
  stored.set(key, bytes);
  const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', 'text/plain', ${bytes.byteLength}, ${sha(bytes)}, now(), now(), ${bytes.byteLength}, 'text/plain') RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type)
    VALUES (${workspace}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, ${bytes.byteLength}, 1, ${key}, ${asset!.id}, 'text/plain') RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${key}, ${asset!.id}, ${bytes.byteLength}, 'text/plain', ${sha(bytes)}, ${userId})`;
}
/** A write to main the way any writer makes one; `ctx` is what the writer tells the save (kind, via). */
async function renameOnMain(workspace: string, from: string, to: string, ctx: Record<string, string> = {}) {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('nb.save', ${JSON.stringify(ctx)}, true)`;
    await tx`UPDATE workspace_nodes SET path = ${to}, name = ${to.split("/").pop()!} WHERE workspace_id = ${workspace} AND path = ${from} AND deleted_at IS NULL`;
  });
}
const refused = (reason: "merge_request" | "agents") => (error: unknown) => {
  const mapped = protect.protectedFromDb(error);
  assert.ok(mapped, `expected BRANCH_PROTECTED, got ${String(error)}`);
  assert.equal(mapped!.code, "BRANCH_PROTECTED");
  assert.equal(mapped!.details?.reason, reason);
  return true;
};

async function team() {
  const owner = await sql.begin((tx) => createUser(tx));
  const dev = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, workspace, dev, "member"));
  await addFile(workspace, owner, "/README.md", "# Demo\n");
  await saves.setBranchesEnabled(actor(owner), workspace, true);
  return { owner, dev, workspace };
}
async function openMr(dev: string, workspace: string, text = "# Demo 2\n") {
  const { branch } = await branches.createBranch(actor(dev), workspace, { name: `dev/${randomUUID().slice(0, 6)}` });
  await branches.saveTextOnBranch(actor(dev), branch.id, { path: "/README.md", text, expectedHash: sha("# Demo\n") });
  const { mergeRequest } = await mrs.createMergeRequest(actor(dev), workspace, { source: branch.name });
  return { branch, number: mergeRequest.number };
}

test("defaults (H5): a team's main takes merge requests with 1 approval; a personal one doesn't; agents on branches in both", async () => {
  const { owner, workspace } = await team();
  const { updatedAt: _at, ...rules } = (await protect.getProtection(actor(owner), workspace)).rules;
  assert.deepEqual(rules, {
    requireMergeRequest: true, approvals: 1, reapproveOnNewSaves: false, requiredChecks: [], mergeBy: "writers", agentsOnBranches: true, allowGithubSync: true,
  });
  const solo = await sql.begin((tx) => createUser(tx));
  const mine = await sql.begin((tx) => createProject(tx, solo));
  await saves.setBranchesEnabled(actor(solo), mine, true);
  const got = await protect.getProtection(actor(solo), mine);
  assert.deepEqual([got.rules.requireMergeRequest, got.rules.approvals, got.rules.agentsOnBranches, got.canChange, got.agentsLocked], [false, 0, true, true, false]);
});

test("a protected main refuses every direct save, and takes a merge request's merge", async () => {
  const { owner, dev, workspace } = await team();
  await assert.rejects(renameOnMain(workspace, "/README.md", "/README2.md"), refused("merge_request"));
  await assert.rejects(renameOnMain(workspace, "/README.md", "/README2.md", { kind: "restore" }), refused("merge_request"));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  assert.equal(n, 1, "rolled back");
  // Revert on a protected main is refused too (it goes through a merge request).
  const { number } = await openMr(dev, workspace);
  await mrs.reviewMergeRequest(actor(owner), workspace, number, { state: "approve" });
  const done = await mrs.mergeMergeRequest(actor(dev), request(), workspace, number, { method: "squash" });
  assert.equal(done.outcome, "merged");
  const [s] = await sql`SELECT kind FROM saves WHERE id = ${done.outcome === "merged" ? done.save!.id : ""}`;
  assert.equal(s!.kind, "squash");
  // Revert on a protected main goes on revert/save-<n> with a merge request; main is untouched until it merges.
  const reverted = await saves.revertSave(actor(owner), request(), done.outcome === "merged" ? done.save!.id : "");
  assert.equal(reverted.outcome, "merge_request");
  assert.equal((reverted as { branch: string }).branch, `revert/save-${(await sql`SELECT seq FROM saves WHERE id = ${done.outcome === "merged" ? done.save!.id : ""}`)[0]!.seq}`);
  const [{ n: still }] = await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md' AND deleted_at IS NULL`;
  assert.equal(still, 1);
});

test("GitHub sync into a protected main: allowed while the owner allows it", async () => {
  const { owner, workspace } = await team();
  await renameOnMain(workspace, "/README.md", "/README2.md", { kind: "sync" });
  await protect.setProtection(actor(owner), workspace, { allowGithubSync: false }, { verified: false });
  await assert.rejects(renameOnMain(workspace, "/README2.md", "/README3.md", { kind: "sync" }), refused("merge_request"));
});

test("merging: approvals, re-approval after new saves, required checks, who merges; agents never into a protected main", async () => {
  const { owner, dev, workspace } = await team();
  const { branch, number } = await openMr(dev, workspace);
  await assert.rejects(mrs.mergeMergeRequest(actor(dev), request(), workspace, number, {}), { code: "APPROVAL_REQUIRED" });
  await assert.rejects(mrs.mergeMergeRequest(agent(owner), request(), workspace, number, {}), { code: "BRANCH_PROTECTED" });
  let view = await mrs.getMergeRequest(actor(dev), workspace, number);
  assert.deepEqual(view.protection.needs, ["Needs 1 more approval"]);
  assert.equal(view.viewer.canOverride, false);
  await protect.setProtection(actor(owner), workspace, { reapproveOnNewSaves: true, requiredChecks: ["build"], mergeBy: "admins" }, { verified: false });
  await mrs.reviewMergeRequest(actor(owner), workspace, number, { state: "approve" });
  await branches.saveTextOnBranch(actor(dev), branch.id, { path: "/README.md", text: "# Demo 3\n", expectedHash: sha("# Demo 2\n") });
  view = await mrs.getMergeRequest(actor(owner), workspace, number);
  assert.deepEqual(view.protection.needs, ["Needs 1 more approval", "Check build hasn't passed"], "the approval was on an earlier save");
  assert.equal(view.viewer.canOverride, true);
  await mrs.reviewMergeRequest(actor(owner), workspace, number, { state: "approve" });
  await assert.rejects(mrs.postCheck(agent(dev), workspace, number, { name: "build", state: "passed" }), { code: "FORBIDDEN" }, "agents don't grade their own work");
  await mrs.postCheck(actor(dev), workspace, number, { name: "build", state: "failed" });
  await assert.rejects(mrs.mergeMergeRequest(actor(owner), request(), workspace, number, {}), { code: "CHECKS_FAILED" });
  await mrs.postCheck(actor(dev), workspace, number, { name: "build", state: "passed" });
  // A check posted before the rules last changed doesn't count: the build posts it again.
  await sql`UPDATE merge_request_checks SET updated_at = now() - interval '1 hour' WHERE name = 'build'`;
  await assert.rejects(mrs.mergeMergeRequest(actor(owner), request(), workspace, number, {}), { code: "CHECKS_FAILED" });
  await mrs.postCheck(actor(dev), workspace, number, { name: "build", state: "passed" });
  await assert.rejects(mrs.mergeMergeRequest(actor(dev), request(), workspace, number, {}), { code: "FORBIDDEN" }, "only admins merge");
  const done = await mrs.mergeMergeRequest(actor(owner), request(), workspace, number, {});
  assert.equal(done.outcome, "merged");
});

test("Merge without approval: owners and admins in the app only, logged on the merge request and in the security log", async () => {
  const { owner, dev, workspace } = await team();
  const { number } = await openMr(dev, workspace);
  await assert.rejects(mrs.mergeMergeRequest(actor(dev), request(), workspace, number, { override: true }), { code: "FORBIDDEN" });
  await assert.rejects(mrs.mergeMergeRequest({ ...actor(owner), tokenScopes: new Set(["file:write"]) }, request(), workspace, number, { override: true }), { code: "FORBIDDEN" });
  const done = await mrs.mergeMergeRequest(actor(owner), request(), workspace, number, { override: true });
  assert.equal(done.outcome, "merged");
  const [e] = await sql`SELECT data FROM merge_request_events WHERE kind = 'merged' AND merge_request_id = (SELECT id FROM merge_requests WHERE workspace_id = ${workspace} AND number = ${number})`;
  assert.equal(e!.data.override, true);
  assert.deepEqual(e!.data.skipped, ["Needs 1 more approval"]);
  const [log] = await sql`SELECT event_type FROM profile_audit_events WHERE user_id = ${owner} ORDER BY created_at DESC LIMIT 1`;
  assert.equal(log!.event_type, "merge_without_approval");
});

test("agents on branches: an agent's save on main is refused even when main takes direct saves; a person's isn't", async () => {
  const solo = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, solo));
  await addFile(workspace, solo, "/a.md", "a\n");
  await saves.setBranchesEnabled(actor(solo), workspace, true);
  await assert.rejects(renameOnMain(workspace, "/a.md", "/b.md", { via: "agent" }), refused("agents"));
  await renameOnMain(workspace, "/a.md", "/b.md");
  await protect.setProtection(actor(solo), workspace, { agentsOnBranches: false }, { verified: true });
  await renameOnMain(workspace, "/b.md", "/c.md", { via: "agent" });
});

test("changing the rules: owners and admins, people only; loosening needs Verify it's you; a team's agents stay on branches", async () => {
  const { owner, dev, workspace } = await team();
  await assert.rejects(protect.setProtection(actor(dev), workspace, { approvals: 2 }, { verified: true }), { code: "FORBIDDEN" });
  await assert.rejects(protect.setProtection(agent(owner), workspace, { approvals: 2 }, { verified: true }), { code: "FORBIDDEN" });
  await assert.rejects(protect.setProtection(actor(owner), workspace, { requireMergeRequest: false }, { verified: false }), { code: "STEP_UP_REQUIRED" });
  await assert.rejects(protect.setProtection(actor(owner), workspace, { agentsOnBranches: false }, { verified: true }), { code: "CONFLICT" });
  await assert.rejects(protect.setProtection(actor(owner), workspace, { approvals: 6 }, { verified: true }), { code: "BAD_REQUEST" });
  await assert.rejects(protect.setProtection(actor(owner), workspace, { requiredChecks: ["bad;name"] }, { verified: true }), { code: "BAD_REQUEST" });
  // Strict types: a string "false" is refused, not taken as a tightening that skips Verify it's you.
  await assert.rejects(protect.setProtection(actor(owner), workspace, { requireMergeRequest: "false" as never }, { verified: false }), { code: "BAD_REQUEST" });
  await protect.setProtection(actor(owner), workspace, { reapproveOnNewSaves: true }, { verified: false });
  await assert.rejects(protect.setProtection(actor(owner), workspace, { reapproveOnNewSaves: false }, { verified: false }), { code: "STEP_UP_REQUIRED" });
  // Only the rules are taken from the patch: another workspace's branch id is ignored.
  const other = await team();
  const [otherMain] = await sql`SELECT id FROM branches WHERE workspace_id = ${other.workspace} AND is_default`;
  await protect.setProtection(actor(owner), workspace, { branchId: otherMain!.id, approvals: 2 } as never, { verified: false });
  const [theirs] = await sql`SELECT approvals FROM branch_protection WHERE branch_id = ${otherMain!.id}`;
  assert.equal(theirs!.approvals, 1, "the other workspace's rules are untouched");
  const tightened = await protect.setProtection(actor(owner), workspace, { approvals: 2, requiredChecks: ["build", "build", "lint"] }, { verified: false });
  assert.deepEqual([tightened.rules.requiredChecks, tightened.loosens], [["build", "lint"], false]);
  const off = await protect.setProtection(actor(owner), workspace, { requireMergeRequest: false }, { verified: true });
  assert.equal(off.loosens, true);
  await renameOnMain(workspace, "/README.md", "/README2.md");
});

test("Save to a new branch (H5, H24): an edit, Use this version and a Trash restore each land on a branch with a merge request", async () => {
  const { owner, dev, workspace } = await team();
  const [node] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  const edit = await branches.saveToNewBranch(actor(dev), workspace, { name: "dev/edit-readme", title: "Edit README", change: { kind: "text", path: "/README.md", text: "# Edited\n", baseHash: sha("# Demo\n") } });
  assert.deepEqual([edit.branch.name, edit.mergeRequest], ["dev/edit-readme", 1]);
  const again = await branches.saveToNewBranch(actor(dev), workspace, { name: "dev/edit-readme", title: "Edit README again", change: { kind: "text", path: "/README.md", text: "# Again\n", baseHash: sha("# Demo\n") } });
  assert.equal(again.branch.name, "dev/edit-readme-2", "a taken name gets a number");
  await assert.rejects(branches.saveToNewBranch(actor(dev), workspace, { name: "dev/stale", title: "x", change: { kind: "text", path: "/README.md", text: "y", baseHash: sha("old") } }), { code: "CHANGE_SET_CONFLICT" });
  await assert.rejects(branches.saveToNewBranch(actor(owner), workspace, { name: "owner/use-v1", title: "Use v1", change: { kind: "version", nodeId: node!.id, version: 1 } }), { code: "MERGE_REQUEST_EMPTY" }, "v1 is already in use");
  assert.equal((await sql`SELECT 1 FROM branches WHERE workspace_id = ${workspace} AND name = 'owner/use-v1'`).length, 0, "no empty branch left");
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('nb.save', '{"kind":"merge"}', true)`;
    await tx`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) SELECT node_id, 2, s3_key, asset_id, size, mime_type, ${sha("v2")}, uploaded_by FROM file_versions WHERE node_id = ${node!.id} AND version = 1`;
    await tx`UPDATE workspace_nodes SET current_version = 2 WHERE id = ${node!.id}`;
  });
  const version = await branches.saveToNewBranch(actor(owner), workspace, { name: "owner/use-v1", title: "Use v1", change: { kind: "version", nodeId: node!.id, version: 1 } });
  assert.equal(version.branch.name, "owner/use-v1");
  await sql.begin(async (tx) => { await tx`SELECT set_config('nb.save', '{"kind":"merge"}', true)`; await tx`UPDATE workspace_nodes SET deleted_at = now() WHERE id = ${node!.id}`; });
  const restored = await branches.saveToNewBranch(actor(owner), workspace, { name: "owner/restore", title: "Restore README", change: { kind: "restore", nodeIds: [node!.id] } });
  assert.equal(restored.branch.name, "owner/restore");
  await assert.rejects(branches.saveToNewBranch(actor(owner), workspace, { name: "owner/nope", title: "x", change: { kind: "restore", nodeIds: [randomUUID()] } }), { code: "NOT_FOUND" });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md' AND deleted_at IS NOT NULL`;
  assert.equal(n, 1, "main untouched: still in the Trash");
});

test("a merge's change set is applied only by the merge (its protection check), never through Apply", async () => {
  const { owner, dev, workspace } = await team();
  const sets = await loadAppModule(() => import("../../src/lib/domain/change-sets"));
  const { number } = await openMr(dev, workspace);
  const held = await sets.startChangeSet(actor(owner), { workspaceId: workspace, title: "held merge" });
  await sql`UPDATE merge_requests SET pending_change_set_id = ${held.id} WHERE workspace_id = ${workspace} AND number = ${number}`;
  await assert.rejects(sets.applyChangeSet(actor(owner), request(), held.id), { code: "CONFLICT" });
});
