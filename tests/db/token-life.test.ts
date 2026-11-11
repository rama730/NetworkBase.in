import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A3.3, A3.9, A3.10: list and revoke your sign-ins; 90 idle days need a new sign-in; device tokens extend
// while used; a new country sends the owner an email.
let headerValues: Record<string, string> = {};
const emails: Array<{ userId: unknown; kind: string; data: any }> = [];
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
moduleStubs.set("@/lib/email/security-queue", { queueSecurityEmail: async (userId: unknown, kind: string, data: any) => { emails.push({ userId, kind, data }); } });

let tokens: typeof import("../../src/app/api/v1/tokens/route");
let revoke: typeof import("../../src/app/api/v1/tokens/[id]/revoke/route");
before(async () => {
  tokens = await loadAppModule(() => import("../../src/app/api/v1/tokens/route"));
  revoke = await loadAppModule(() => import("../../src/app/api/v1/tokens/[id]/revoke/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function device(userId: string, opts: { expiresIn: string; idle?: string; country?: string | null; createdAgo?: string }) {
  const token = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, last_seen_at, created_at, token_type, last_country)
    VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.0', now() + ${opts.expiresIn}::interval, now() - ${opts.idle ?? "0 minutes"}::interval, now() - ${opts.createdAgo ?? "1 day"}::interval, 'device', ${opts.country ?? null})
    RETURNING id`;
  return { token, id: row!.id as string };
}
const call = async (handler: (r: Request, c?: any) => Promise<Response>, token: string, method: string, path: string, extra: Record<string, string> = {}, ctx?: unknown) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path, ...extra };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }), ctx);
  return { status: res.status, json: await res.json() };
};
const settle = () => new Promise((r) => setTimeout(r, 150));

test("lists your sign-ins with this one marked; revoke takes another one away", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const mine = await device(userId, { expiresIn: "60 days" });
  const other = await device(userId, { expiresIn: "60 days" });
  const list = await call(tokens.GET, mine.token, "GET", "/api/v1/tokens");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const rows = list.json.data.tokens as Array<{ id: string; current: boolean }>;
  assert.deepEqual(rows.filter((t) => t.current).map((t) => t.id), [mine.id]);
  assert.ok(rows.some((t) => t.id === other.id));
  const r = await call(revoke.POST, mine.token, "POST", `/api/v1/tokens/${other.id}/revoke`, {}, { params: Promise.resolve({ id: other.id }) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await call(tokens.GET, other.token, "GET", "/api/v1/tokens")).status, 401);
  const stranger = await sql.begin((tx) => createUser(tx));
  const theirs = await device(stranger, { expiresIn: "60 days" });
  const no = await call(revoke.POST, mine.token, "POST", `/api/v1/tokens/${theirs.id}/revoke`, {}, { params: Promise.resolve({ id: theirs.id }) });
  assert.equal(no.status, 404);
});

test("agent rows carry the sentence Settings and nb agent status show (report A4)", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const mine = await device(userId, { expiresIn: "60 days" });
  const [agent] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, all_workspaces, scopes)
    VALUES (${userId}, ${hash(`nb_agt_${randomUUID()}`)}, 'nb_agt_x', 'laptop', '2.0.4', now() + interval '7 days', 'agent', 'Claude Code', true, ${sql.json(["workspace:read", "task:read", "file:read"])}) RETURNING id`;
  const rows = (await call(tokens.GET, mine.token, "GET", "/api/v1/tokens")).json.data.tokens as Array<{ id: string; access?: string }>;
  assert.equal(rows.find((t) => t.id === agent!.id)?.access, "Claude Code can read all your workspaces for 7 days. It can’t change anything.");
  assert.equal(rows.find((t) => t.id === mine.id)?.access, undefined);
});

test("90 idle days need a new sign-in", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const idle = await device(userId, { expiresIn: "60 days", idle: "91 days" });
  const r = await call(tokens.GET, idle.token, "GET", "/api/v1/tokens");
  assert.equal(r.status, 401);
  assert.match(r.json.message, /wasn't used for 90 days/);
});

test("a device token close to expiry is extended on use, never past a year from approval", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const soon = await device(userId, { expiresIn: "10 days" });
  assert.equal((await call(tokens.GET, soon.token, "GET", "/api/v1/tokens")).status, 200);
  await settle();
  const [a] = await sql`SELECT expires_at > now() + interval '80 days' AS extended FROM extension_device_sessions WHERE id = ${soon.id}`;
  assert.equal(a!.extended, true);
  const old = await device(userId, { expiresIn: "10 days", createdAgo: "300 days" });
  assert.equal((await call(tokens.GET, old.token, "GET", "/api/v1/tokens")).status, 200);
  await settle();
  const [b] = await sql`SELECT expires_at BETWEEN now() + interval '64 days' AND now() + interval '66 days' AS capped FROM extension_device_sessions WHERE id = ${old.id}`;
  assert.equal(b!.capped, true);
});

test("use from a new country emails the owner once; the first country is just recorded", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const d = await device(userId, { expiresIn: "60 days" });
  emails.length = 0;
  await call(tokens.GET, d.token, "GET", "/api/v1/tokens", { "cf-ipcountry": "IN" });
  await settle();
  assert.equal(emails.length, 0);
  assert.equal((await sql`SELECT last_country FROM extension_device_sessions WHERE id = ${d.id}`)[0]!.last_country, "IN");
  await call(tokens.GET, d.token, "GET", "/api/v1/tokens", { "cf-ipcountry": "DE" });
  await settle();
  assert.deepEqual(emails.map((e) => [e.userId, e.kind]), [[userId, "security_new_sign_in"]]);
  assert.match(emails[0]!.data.detail, /new country \(DE\)/);
});
