import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Create workspace v6 (Task 4): the address Info previews is the address Create gives — the plain name when free,
// then -2, -3 … never a random ending. Reserved words and held organization handles are skipped the same way.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.44" }) });
stubNextAfter();

let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
let preview: typeof import("../../src/lib/workspaces/server/slug-preview");
before(async () => {
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  preview = await loadAppModule(() => import("../../src/lib/workspaces/server/slug-preview"));
  viewerId = await sql.begin((tx) => createUser(tx));
});
const created: string[] = [];
after(async () => {
  for (const id of created) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Input = Parameters<typeof import("../../src/lib/workspaces/server/lifecycle").createWorkspaceAction>[0];
// Words only: the slug base keeps letters, so each run gets its own name.
const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 8) || "abcdefgh";
const make = async (title: string, slug?: string) => {
  const result = await lifecycle.createWorkspaceAction({ title, description: "A shared map of community gardens and volunteer days.", project_type: "side_project", ...(slug ? { slug } : {}) } as unknown as Input);
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  return result.project!.slug;
};

test("a free name previews and creates its plain address", async () => {
  const title = `Garden ${word()}`;
  const p = await preview.previewWorkspaceSlug(title);
  assert.equal(p.taken, false);
  assert.equal(p.slug, p.base);
  assert.equal(await make(title, p.slug), p.base);
});

test("a taken name previews -2, and Create gives -2", async () => {
  const title = `Orchard ${word()}`;
  const first = await make(title);
  const p = await preview.previewWorkspaceSlug(title);
  assert.equal(p.base, first);
  assert.equal(p.taken, true);
  assert.equal(p.slug, `${first}-2`);
  assert.equal(await make(title, p.slug), `${first}-2`);
  assert.equal((await preview.previewWorkspaceSlug(title)).slug, `${first}-3`);
});

test("two people creating the same name at once get the plain address and -2, never a random ending", async () => {
  const title = `Meadow ${word()}`;
  const p = await preview.previewWorkspaceSlug(title);
  const slugs = (await Promise.all([make(title, p.slug), make(title, p.slug)])).sort();
  assert.deepEqual(slugs, [p.base, `${p.base}-2`]);
});

test("a reserved word or a held organization handle skips to -2", async () => {
  const reserved = await preview.previewWorkspaceSlug("New");
  assert.equal(reserved.base, "new");
  assert.equal(reserved.slug, "new-2");
  const held = `hedge-${word()}`;
  const [org] = await sql`SELECT id FROM workspaces LIMIT 1` as unknown as [{ id: string } | undefined];
  if (org) {
    await sql`INSERT INTO org_handle_holds (handle, org_id, held_until) VALUES (${held}, ${org.id}, now() + interval '30 days')`;
    try {
      assert.equal((await preview.previewWorkspaceSlug(held.replace("-", " "))).slug, `${held}-2`);
    } finally {
      await sql`DELETE FROM org_handle_holds WHERE handle = ${held}`;
    }
  }
});
