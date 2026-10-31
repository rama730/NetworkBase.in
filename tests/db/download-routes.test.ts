import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// The real route handlers against a real database. Only sign-in, storage and the rate limiter are stand-ins.
let viewer: string | null = null;
const signed: Array<{ bucket: string; key: string; seconds: number; options: unknown }> = [];
let preview: typeof import("../../src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route");
let chat: typeof import("../../src/app/api/v1/chat/attachments/[assetId]/route");
let exportRoute: typeof import("../../src/app/api/v1/workspaces/[id]/files/export/route");
const users: string[] = [];

// The real next/server, except that work after the response runs straight away.
const realNextServer = createRequire(import.meta.url)("next/server");
stubNextAfter();
moduleStubs.set("next/server", { ...realNextServer, after: (moduleStubs.get("next/server") as { after: unknown }).after });
const admin = {
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: async (key: string, seconds: number, options?: unknown) => {
        signed.push({ bucket, key, seconds, options });
        return { data: { signedUrl: `https://storage.test/${key}?signed=1` }, error: null };
      },
    }),
  },
};
const signedInUser = () => (viewer ? { id: viewer } : null);

before(async () => {
  moduleStubs.set("@/lib/supabase/server", {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedInUser() } }) } }),
    createAdminClient: async () => admin,
  });
  moduleStubs.set("@/app/api/v1/_shared", {
    enforceDownloadLimit: async () => null,
    enforceFileReadLimit: async () => null,
    enforceRouteLimit: async () => null,
    getRequestId: () => "test",
    logApiRoute: () => undefined,
    requireAuthenticatedUser: async () => (viewer
      ? { user: { id: viewer }, response: null }
      : { user: null, response: new Response(null, { status: 401 }) }),
    jsonError: (message: string, status: number) => new Response(JSON.stringify({ message }), { status }),
  });
  preview = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route"));
  chat = await loadAppModule(() => import("../../src/app/api/v1/chat/attachments/[assetId]/route"));
  exportRoute = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/files/export/route"));
});
afterEach(async () => {
  signed.length = 0;
  viewer = null;
  if (users.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(users)}`;
  users.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const request = (url: string, method = "GET") => {
  const absolute = `https://app.test${url}`;
  return Object.assign(new Request(absolute, { method }), { nextUrl: new URL(absolute) }) as never;
};

async function seedFile(name: string, options: { visibility?: string; state?: string } = {}) {
  return sql.begin(async (tx) => {
    const owner = await createUser(tx);
    const outsider = await createUser(tx);
    users.push(owner, outsider);
    const projectId = await createProject(tx, owner, { visibility: options.visibility ?? "private" });
    const key = `${projectId}/files/${randomUUID()}`;
    const [asset] = await tx`
      INSERT INTO public.storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
      VALUES (${owner}, ${projectId}, 'project-files', ${key}, 'workspace_file', 'verified', 'application/pdf', 3, 'application/pdf', 3, now(), 'hash', now() + interval '1 day')
      RETURNING id`;
    const nodeId = randomUUID();
    await tx`INSERT INTO public.workspace_nodes (id, workspace_id, type, name, s3_key, asset_id, size, mime_type, path, current_version)
             VALUES (${nodeId}, ${projectId}, 'file', ${name}, ${key}, ${asset!.id}, 3, 'application/pdf', ${`/${randomUUID()}`}, 2)`;
    await tx`INSERT INTO public.file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash)
             VALUES (${nodeId}, 2, ${key}, ${asset!.id}, 3, 'application/pdf', 'hash'), (${nodeId}, 1, ${key}, ${asset!.id}, 3, 'application/pdf', 'hash')`;
    return { owner, outsider, projectId, nodeId, key };
  });
}
const previewContext = (file: { projectId: string; nodeId: string }) => ({ params: Promise.resolve({ id: file.projectId, nodeId: file.nodeId }) });
const previewUrl = (file: { projectId: string; nodeId: string }, query = "") => `/api/v1/workspaces/${file.projectId}/files/${file.nodeId}/preview${query}`;
const historyRows = (projectId: string) => sql`SELECT kind, file_name, actor_id, file_count FROM public.workspace_download_events WHERE workspace_id = ${projectId} ORDER BY created_at`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("downloading a file with a non-English name saves it under that name, and is recorded once", async () => {
  const file = await seedFile("日本語 it’s.pdf");
  viewer = file.owner;
  const res = await preview.GET(request(previewUrl(file, "?download=1")), previewContext(file));
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location")!, /^https:\/\/storage\.test\//);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(signed[0], { bucket: "project-files", key: file.key, seconds: 60, options: { download: "日本語 it’s.pdf" } });
  await settle();
  const rows = await historyRows(file.projectId);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { kind: "file", file_name: "日本語 it’s.pdf", actor_id: file.owner, file_count: 1 });
});

test("viewing with a non-English name works too, and neither a view nor the check is recorded", async () => {
  const file = await seedFile("दस्तावेज़ — final.pdf");
  viewer = file.owner;
  const head = await preview.HEAD(request(previewUrl(file, "?download=1"), "HEAD"), previewContext(file));
  assert.equal(head.status, 200);
  assert.equal(signed.length, 0, "the check signs nothing");
  const view = await preview.HEAD(request(previewUrl(file, "?v=2"), "HEAD"), previewContext(file));
  assert.equal(view.status, 200);
  assert.match(view.headers.get("content-disposition")!, /^inline; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
  assert.equal(view.headers.get("cache-control"), "private, no-cache");
  await settle();
  assert.equal((await historyRows(file.projectId)).length, 0);
});

test("an old version saves as report.v1.pdf; a version that doesn't exist is 404, not the current file", async () => {
  const file = await seedFile("report.pdf");
  viewer = file.owner;
  const old = await preview.GET(request(previewUrl(file, "?revision=1&download=1")), previewContext(file));
  assert.equal(old.status, 302);
  assert.deepEqual(signed[0]!.options, { download: "report.v1.pdf" });
  await settle();
  assert.equal((await historyRows(file.projectId))[0]!.kind, "version");
  const current = await preview.GET(request(previewUrl(file, "?revision=2&download=1")), previewContext(file));
  assert.equal(current.status, 302);
  assert.deepEqual(signed[1]!.options, { download: "report.pdf" });
  const missing = await preview.GET(request(previewUrl(file, "?revision=99&download=1")), previewContext(file));
  assert.equal(missing.status, 404);
});

test("no access means no download, for a stranger and for a signed-out visitor", async () => {
  const file = await seedFile("private.pdf");
  for (const who of [file.outsider, null]) {
    viewer = who;
    for (const method of ["HEAD", "GET"] as const) {
      const res = await preview[method](request(previewUrl(file, "?download=1"), method), previewContext(file));
      assert.equal(res.status, 403, `${who} ${method}`);
    }
  }
  assert.equal(signed.length, 0);
  await settle();
  assert.equal((await historyRows(file.projectId)).length, 0);
});

test("the old preview token no longer opens anything", async () => {
  const file = await seedFile("private.pdf");
  viewer = null;
  const res = await preview.GET(request(previewUrl(file, "?token=anything.signature")), previewContext(file));
  assert.equal(res.status, 403);
});

test("a message attachment saves under its real name; only channel members can have it", async () => {
  const seeded = await sql.begin(async (tx) => {
    const uploader = await createUser(tx);
    const member = await createUser(tx);
    const stranger = await createUser(tx);
    users.push(uploader, member, stranger);
    const [channel] = await tx`INSERT INTO public.chat_channels (kind, name, created_by) VALUES ('private', 'dl-test', ${uploader}) RETURNING id`;
    await tx`INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (${channel!.id}, ${uploader}), (${channel!.id}, ${member})`;
    const key = `${channel!.id}/${uploader}/${randomUUID()}.pdf`;
    const [asset] = await tx`
      INSERT INTO public.storage_assets (owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
      VALUES (${uploader}, 'chat-attachments', ${key}, 'chat_attachment', 'verified', 'application/pdf', 3, 'application/pdf', 3, now(), 'hash', now() + interval '1 day')
      RETURNING id`;
    const [message] = await tx`INSERT INTO public.chat_messages (channel_id, channel_seq, author_id, body) VALUES (${channel!.id}, 1, ${uploader}, 'hi') RETURNING channel_seq AS seq`;
    await tx`INSERT INTO public.chat_attachments (channel_id, message_seq, idx, asset_id, name, mime, size)
             VALUES (${channel!.id}, ${message!.seq}, 0, ${asset!.id}, '請求書.pdf', 'application/pdf', 3)`;
    return { uploader, member, stranger, assetId: asset!.id as string, key };
  });
  const url = `/api/v1/chat/attachments/${seeded.assetId}`;
  const context = () => ({ params: Promise.resolve({ assetId: seeded.assetId }) });

  viewer = seeded.member;
  const check = await chat.HEAD(request(`${url}?download=1`, "HEAD") as unknown as Request, context());
  assert.equal(check.status, 200);
  assert.equal(signed.length, 0, "the check signs nothing");
  const saved = await chat.GET(request(`${url}?download=1`) as unknown as Request, context());
  assert.equal(saved.status, 302);
  assert.deepEqual(signed[0]!.options, { download: "請求書.pdf" });
  assert.equal(signed[0]!.seconds, 60);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  const view = await chat.GET(request(url) as unknown as Request, context());
  assert.equal(view.status, 302);
  assert.equal(signed[1]!.options, undefined, "viewing doesn't force a save");

  viewer = seeded.stranger;
  assert.equal((await chat.HEAD(request(`${url}?download=1`, "HEAD") as unknown as Request, context())).status, 404);
  await sql`DELETE FROM public.chat_channel_members WHERE user_id = ${seeded.member}`;
  viewer = seeded.member;
  assert.equal((await chat.GET(request(`${url}?download=1`) as unknown as Request, context())).status, 404, "removed members lose it");
});

test("the zip check pins nothing; empty and oversized selections say why", async () => {
  const file = await seedFile("a.pdf");
  viewer = file.owner;
  const context = () => ({ params: Promise.resolve({ id: file.projectId }) });
  const base = `/api/v1/workspaces/${file.projectId}/files/export`;
  const check = await exportRoute.HEAD(request(`${base}?name=Chosen&ids=${file.nodeId}`, "HEAD"), context());
  assert.equal(check.status, 200);
  assert.equal((await sql`SELECT count(*)::int AS n FROM public.storage_asset_pins p JOIN public.storage_assets a ON a.id = p.asset_id WHERE a.storage_key = ${file.key}`)[0]!.n, 0);
  const tooMany = Array.from({ length: 101 }, () => randomUUID()).join(",");
  assert.equal((await exportRoute.HEAD(request(`${base}?ids=${tooMany}`, "HEAD"), context())).status, 413);
  assert.equal((await exportRoute.HEAD(request(`${base}?ids=${randomUUID()}`, "HEAD"), context())).status, 422);
  assert.equal((await exportRoute.HEAD(request(`${base}?ids=not-a-uuid`, "HEAD"), context())).status, 404);
  viewer = file.outsider;
  assert.equal((await exportRoute.HEAD(request(`${base}?ids=${file.nodeId}`, "HEAD"), context())).status, 403);
  await settle();
  assert.equal((await historyRows(file.projectId)).length, 0, "a check isn't a download");
});

test("a member of a private workspace can download; removing them stops it", async () => {
  const file = await seedFile("team.pdf");
  await sql.begin((tx) => addMember(tx, file.projectId, file.outsider));
  viewer = file.outsider;
  assert.equal((await preview.HEAD(request(previewUrl(file, "?download=1"), "HEAD"), previewContext(file))).status, 200);
  await sql`DELETE FROM public.workspace_members WHERE workspace_id = ${file.projectId} AND user_id = ${file.outsider}`;
  assert.equal((await preview.HEAD(request(previewUrl(file, "?download=1"), "HEAD"), previewContext(file))).status, 403);
});
