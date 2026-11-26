import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Search + AI findability (Task 3): a bot and the .md copy see exactly what a signed-out person sees, never more.
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.45" }), cookies: async () => ({ get: () => undefined, getAll: () => [] }) });
stubNextAfter();

let snap: typeof import("../../src/lib/public-pages/snapshot");
let owner = "";
const made: string[] = [];
before(async () => {
  snap = await loadAppModule(() => import("../../src/lib/public-pages/snapshot"));
  owner = await sql.begin((tx) => createUser(tx));
});
after(async () => {
  try {
    for (const id of made) await sql`DELETE FROM workspaces WHERE id = ${id}`;
    if (owner) await sql`DELETE FROM profiles WHERE id = ${owner}`;
  } finally {
    await sql.end();
    await closeAppDb();
  }
});

const README = "## Setup\n\nRun the crawler with care.";
async function workspace(opts: { visibility?: string; tabs?: Record<string, boolean>; docSettings?: object } = {}) {
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: opts.visibility, publicTabVisibility: opts.tabs }));
  made.push(id);
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings)
    VALUES (${id}, 'readme', 'README.md', ${sql.json({ version: 1, visibilityOverride: "inherit_workspace", ...opts.docSettings } as never)}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash)
    VALUES (${id}, ${d!.id}, 1, ${README}, 'h1') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, visibility) VALUES
    (${id}, ${owner}, 'Public progress note', 'progress', 'public'),
    (${id}, ${owner}, 'Members only secret note', 'progress', 'members')`;
  const [{ slug }] = await sql`SELECT slug FROM workspaces WHERE id = ${id}`;
  return { id, slug: slug as string };
}
const full = (r: Awaited<ReturnType<typeof snap.readPublicWorkspaceSnapshot>>) => {
  assert.ok("readme" in r, JSON.stringify(r.preview));
  return r;
};

test("a public workspace gives its README and only public updates", async () => {
  const { slug } = await workspace();
  const r = full(await snap.readPublicWorkspaceSnapshot("/workspaces", slug));
  assert.equal(r.kind, "project");
  assert.match(r.readme?.markdown ?? "", /Run the crawler with care\./);
  assert.deepEqual(r.updates.map((u) => u.text), ["Public progress note"]);
});

test("hidden README or Updates tabs give nothing for that tab", async () => {
  const a = full(await snap.readPublicWorkspaceSnapshot("/workspaces", (await workspace({ tabs: { readme: false } })).slug));
  assert.equal(a.readme, null);
  const b = full(await snap.readPublicWorkspaceSnapshot("/workspaces", (await workspace({ tabs: { updates: false } })).slug));
  assert.deepEqual(b.updates, []);
});

test("a members-only README is left out", async () => {
  const r = full(await snap.readPublicWorkspaceSnapshot("/workspaces", (await workspace({ docSettings: { visibilityOverride: "members_only" } })).slug));
  assert.equal(r.readme, null);
});

test("a private workspace gives only its restricted preview", async () => {
  const r = await snap.readPublicWorkspaceSnapshot("/workspaces", (await workspace({ visibility: "private" })).slug);
  assert.equal(r.preview.state, "restricted");
  assert.equal("readme" in r, false);
  assert.equal(JSON.stringify(r).includes("crawler with care"), false);
});

test("an unlisted workspace reads in full but is not indexable", async () => {
  const r = full(await snap.readPublicWorkspaceSnapshot("/workspaces", (await workspace({ visibility: "unlisted" })).slug));
  assert.equal(r.preview.indexable, false);
});

test("a workspace hidden from Discover is not indexable", async () => {
  const { id, slug } = await workspace();
  await sql`UPDATE workspaces SET discover_hidden_at = now() WHERE id = ${id}`;
  const r = full(await snap.readPublicWorkspaceSnapshot("/workspaces", slug));
  assert.equal(r.preview.indexable, false);
});

test("a private profile gives nothing; a public one gives bio and public workspaces only", async () => {
  const [hidden, shown] = await sql.begin(async (tx) => [await createUser(tx, { visibility: "private" }), await createUser(tx)]);
  await sql`UPDATE profiles SET bio = 'Secret bio text' WHERE id = ${hidden}`;
  await sql`UPDATE profiles SET bio = 'Open bio text' WHERE id = ${shown}`;
  const pub = await workspace();
  const priv = await workspace({ visibility: "private" });
  for (const w of [pub, priv]) await sql`INSERT INTO profile_contributions (profile_id, workspace_id, role_title, visibility, role_kind) VALUES (${shown}, ${w.id}, 'Builder', 'public', 'contributor')`;
  const [[h], [s]] = await Promise.all([sql`SELECT username FROM profiles WHERE id = ${hidden}`, sql`SELECT username FROM profiles WHERE id = ${shown}`]);
  for (const [id, u] of [[hidden, h!.username], [shown, s!.username]]) await sql`INSERT INTO username_aliases (username, user_id, is_primary) VALUES (${u}, ${id}, true) ON CONFLICT DO NOTHING`;
  try {
    const a = await snap.readPublicProfileSnapshot(h!.username);
    assert.equal("bio" in a, false);
    assert.equal(JSON.stringify(a).includes("Secret bio text"), false);
    const b = await snap.readPublicProfileSnapshot(s!.username);
    assert.ok("bio" in b, JSON.stringify(b.preview));
    assert.equal(b.bio, "Open bio text");
    assert.deepEqual(b.workspaces.map((w) => w.url.endsWith(`/workspaces/${pub.slug}`)), [true]);
  } finally {
    await sql`DELETE FROM profile_contributions WHERE profile_id = ${shown}`;
    await sql`DELETE FROM username_aliases WHERE user_id IN (${hidden}, ${shown})`;
    await sql`DELETE FROM profiles WHERE id IN (${hidden}, ${shown})`;
  }
});
