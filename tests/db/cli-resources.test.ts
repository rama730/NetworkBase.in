import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §18.2 / A2.5: "how many tasks do I have", who am I, the workspace's docs, and README edits needing
// doc:write — all through real tokens and the same access checks a CLI or agent request gets.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let count: typeof import("../../src/app/api/v1/tasks/count/route");
let me: typeof import("../../src/app/api/v1/me/route");
let docs: typeof import("../../src/app/api/v1/workspaces/[id]/docs/route");
let place: typeof import("../../src/app/api/v1/files/place/route");
before(async () => {
  count = await loadAppModule(() => import("../../src/app/api/v1/tasks/count/route"));
  me = await loadAppModule(() => import("../../src/app/api/v1/me/route"));
  docs = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/docs/route"));
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function patFor(userId: string, scopes: string[]) {
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes)
            VALUES (${userId}, 'test', ${createHash("sha256").update(token).digest("hex")}, ${token.slice(0, 12)}, ${sql.json(scopes)})`;
  return token;
}
const as = (token: string, method: string, target: string) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
};

test("task count matches the person's open work across workspaces", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const other = await sql.begin((tx) => createUser(tx));
  const a = await sql.begin((tx) => createProject(tx, userId));
  const b = await sql.begin((tx) => createProject(tx, userId));
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const past = new Date(Date.now() - 24 * 3600 * 1000);
  await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, due_date) VALUES
    (${a}, 'one', 'todo', ${userId}, ${soon}),
    (${a}, 'two', 'in_progress', ${userId}, ${past}),
    (${b}, 'three', 'blocked', ${userId}, null),
    (${b}, 'done', 'done', ${userId}, null),
    (${b}, 'not mine', 'todo', ${other}, null)`;
  await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, review_status) VALUES (${b}, 'in review', 'done', ${userId}, 'pending')`;
  as(await patFor(userId, ["repo:read"]), "GET", "/api/v1/tasks/count");
  const res = await count.GET(new Request("https://app.test/api/v1/tasks/count"));
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  const { workspaces, ...totals } = json.data;
  assert.deepEqual(totals, { open: 4, byStatus: { todo: 1, in_progress: 1, blocked: 1, in_review: 1 }, overdue: 1, dueThisWeek: 1 });
  // D24 (walkthrough #13): the count names the workspaces it covers, so "1 overdue" isn't read as this one's.
  const [ta, tb] = await Promise.all([a, b].map(async (id) => (await sql`SELECT title FROM workspaces WHERE id = ${id}`)[0]!.title as string));
  assert.deepEqual(workspaces, [{ id: a, title: ta, open: 2, overdue: 1, dueThisWeek: 1 }, { id: b, title: tb, open: 2, overdue: 0, dueThisWeek: 0 }].sort((x, y) => y.open - x.open || x.title.localeCompare(y.title)));
});

test("me says who is signed in, what the token may do, and the file limit", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  as(await patFor(userId, ["repo:read"]), "GET", "/api/v1/me");
  const json = await (await me.GET(new Request("https://app.test/api/v1/me"))).json();
  assert.equal(json.data.user.id, userId);
  assert.equal(json.data.credential.kind, "token");
  assert.deepEqual(json.data.credential.scopes, ["file:read", "task:read", "workspace:read"]);
  assert.ok(json.data.limits.largestFileBytes > 0);
});

test("docs are listed for a token, and editing the file behind the README needs doc:write", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, current_version)
    VALUES (${projectId}, 'file', 'README.md', '/README.md', ${userId}, 1) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash)
    VALUES (${node!.id}, 1, ${`projects/${projectId}/files/README.md`}, 1, 'text/markdown', ${userId}, ${"c".repeat(64)})`;
  await sql`UPDATE workspace_nodes SET size = 1 WHERE id = ${node!.id}`;
  await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id) VALUES (${projectId}, ${node!.id})`;

  as(await patFor(userId, ["repo:read"]), "GET", `/api/v1/workspaces/${projectId}/docs`);
  const listed = await (await docs.GET(new Request(`https://app.test/api/v1/workspaces/${projectId}/docs`), { params: Promise.resolve({ id: projectId }) })).json();
  assert.equal(listed.success, true, JSON.stringify(listed));
  assert.deepEqual(listed.data.docs.map((d: { slug: string; linkedNodeId: string }) => [d.slug, d.linkedNodeId]), [["readme", node!.id]]);

  const text = "# New README\n";
  const body = { projectId, files: [{ path: "/README.md", contentHash: createHash("sha256").update(text).digest("hex"), size: text.length, mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64"), baseVersion: 1 }] };
  as(await patFor(userId, ["repo:read", "repo:write"]), "POST", "/api/v1/files/place");
  const refused = await place.POST(new Request("https://app.test/api/v1/files/place", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) }));
  const refusedJson = await refused.json();
  assert.equal(refused.status, 403, JSON.stringify(refusedJson));
  assert.equal(refusedJson.details.scope, "doc:write");
});
