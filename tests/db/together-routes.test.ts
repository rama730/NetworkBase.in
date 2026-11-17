import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createRequire } from "node:module";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Report C4 (M4b): notification settings, members (your own sign-in only) and the updates feed, with CLI tokens.
let headerValues: Record<string, string> = {};
// The real next/server, except that work after the response runs straight away (likes use after()).
const realNextServer = createRequire(import.meta.url)("next/server");
stubNextAfter();
moduleStubs.set("next/server", { ...realNextServer, after: (moduleStubs.get("next/server") as { after: unknown }).after });
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let prefs: typeof import("../../src/app/api/v1/me/notifications/route");
let members: typeof import("../../src/app/api/v1/workspaces/[id]/members/route");
let updates: typeof import("../../src/app/api/v1/workspaces/[id]/updates/route");
let oneUpdate: typeof import("../../src/app/api/v1/workspaces/[id]/updates/[updateId]/route");
before(async () => {
  prefs = await loadAppModule(() => import("../../src/app/api/v1/me/notifications/route"));
  members = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/members/route"));
  updates = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/updates/route"));
  oneUpdate = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/updates/[updateId]/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function device(userId: string) {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at) VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return raw;
}
async function pat(userId: string) {
  const raw = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes) VALUES (${userId}, 'ci', ${hash(raw)}, ${raw.slice(0, 12)}, ${sql.json(["workspace:read", "task:read", "task:write"])})`;
  return raw;
}
function req(raw: string, method: string, url: string, body?: unknown) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": new URL(url, "https://app.test").pathname };
  return new Request(`https://app.test${url}`, { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("notification settings: only the named ones change", async () => {
  const user = await sql.begin((tx) => createUser(tx));
  const raw = await device(user);
  const changed = await (await prefs.PATCH(req(raw, "PATCH", "/api/v1/me/notifications", { projects: false, quietHours: { enabled: true, startMinute: 1320, endMinute: 480 } }))).json();
  assert.equal(changed.data.preferences.projects, false);
  assert.equal(changed.data.preferences.mentions, true, "untouched");
  assert.equal(changed.data.preferences.quietHours.enabled, true);
  const read = await (await prefs.GET(req(raw, "GET", "/api/v1/me/notifications"))).json();
  assert.equal(read.data.preferences.projects, false);
  assert.equal((await prefs.PATCH(req(raw, "PATCH", "/api/v1/me/notifications", { projects: "no" }))).status, 400);
});

test("members: role and removal by the owner's own sign-in; a personal token can't; a member can leave", async () => {
  const [owner, sam, kim] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${sam!}, 'member'), (${ws}, ${kim!}, 'member')`;
  const [{ username: samName }] = await sql`SELECT username FROM profiles WHERE id = ${sam!}`;
  const ownerRaw = await device(owner!);
  const ctx = { params: Promise.resolve({ id: ws }) };
  const noRoles = await members.POST(req(ownerRaw, "POST", `/api/v1/workspaces/${ws}/members`, { username: samName, role: "Designer" }) as never, ctx);
  assert.match((await noRoles.json()).message, /no open roles/, "invitations are for an open role");
  const role = await members.PATCH(req(ownerRaw, "PATCH", `/api/v1/workspaces/${ws}/members`, { username: samName, role: "admin" }) as never, ctx);
  assert.equal(role.status, 200, await role.clone().text());
  assert.equal((await sql`SELECT role FROM workspace_members WHERE workspace_id = ${ws} AND user_id = ${sam!}`)[0]!.role, "admin");
  const viaPat = await members.PATCH(req(await pat(owner!), "PATCH", `/api/v1/workspaces/${ws}/members`, { username: samName, role: "member" }) as never, ctx);
  assert.equal(viaPat.status, 403, "a personal token can't change members");
  // "_" and "%" are LIKE wildcards: a name that only pattern-matches Kim must not change Kim.
  const [{ username: kimName }] = await sql`SELECT username FROM profiles WHERE id = ${kim!}`;
  const lookalike = await members.PATCH(req(ownerRaw, "PATCH", `/api/v1/workspaces/${ws}/members`, { username: `${kimName.slice(0, 2)}_${kimName.slice(3)}`, role: "admin" }) as never, ctx);
  assert.equal(lookalike.status, 404, "names match exactly, ignoring case only");
  const kimRaw = await device(kim!);
  const left = await members.DELETE(req(kimRaw, "DELETE", `/api/v1/workspaces/${ws}/members`, { leave: true }) as never, ctx);
  assert.equal(left.status, 200, await left.clone().text());
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${ws} AND user_id = ${kim!}`)[0]!.n, 0);
  const ownerLeaves = await members.DELETE(req(ownerRaw, "DELETE", `/api/v1/workspaces/${ws}/members`, { leave: true }) as never, ctx);
  assert.notEqual(ownerLeaves.status, 200, "the owner can't leave");
  // Removing someone else from the terminal needs "Verify it's you" in the browser first (report F5).
  const unverified = await members.DELETE(req(ownerRaw, "DELETE", `/api/v1/workspaces/${ws}/members`, { username: samName }) as never, ctx);
  assert.equal(unverified.status, 403);
  assert.equal((await unverified.json() as { errorCode: string }).errorCode, "STEP_UP_REQUIRED");
  await sql`UPDATE extension_device_sessions SET step_up_until = now() + interval '10 minutes' WHERE user_id = ${owner!}`;
  const removed = await members.DELETE(req(ownerRaw, "DELETE", `/api/v1/workspaces/${ws}/members`, { username: samName }) as never, ctx);
  assert.equal(removed.status, 200, await removed.clone().text());
});

test("updates: post, list, like and comment with a CLI token", async (t) => {
  const [owner, sam] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  // The workspace is public, so its update would show in the Discover feed that discover-updates.test.ts checks.
  t.after(() => sql`DELETE FROM workspace_updates WHERE workspace_id = ${ws}`);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${sam!}, 'member')`;
  const ownerRaw = await device(owner!);
  const ctx = { params: Promise.resolve({ id: ws }) };
  const posted = await updates.POST(req(ownerRaw, "POST", `/api/v1/workspaces/${ws}/updates`, { content: "Shipped the logo" }), ctx);
  assert.equal(posted.status, 200, await posted.clone().text());
  const samRaw = await device(sam!);
  const listed = await (await updates.GET(req(samRaw, "GET", `/api/v1/workspaces/${ws}/updates`), ctx)).json();
  assert.equal(listed.success, true, JSON.stringify(listed));
  const update = listed.data.updates[0];
  assert.match(JSON.stringify(update), /Shipped the logo/);
  const one = { params: Promise.resolve({ id: ws, updateId: update.id }) };
  assert.equal((await oneUpdate.POST(req(samRaw, "POST", `/api/v1/workspaces/${ws}/updates/${update.id}`, { kind: "like" }), one)).status, 200);
  const commented = await oneUpdate.POST(req(samRaw, "POST", `/api/v1/workspaces/${ws}/updates/${update.id}`, { kind: "comment", text: "nice work" }), one);
  assert.equal(commented.status, 200, await commented.clone().text());
  const comments = await (await oneUpdate.GET(req(samRaw, "GET", `/api/v1/workspaces/${ws}/updates/${update.id}`), one)).json();
  assert.match(JSON.stringify(comments.data.comments), /nice work/);
});
