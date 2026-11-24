import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A7.3 (report 38.16 W5, W7, W8, calls 4–5): Colors and outside links are saved by people who can change
// files (links must be http(s) and are never fetched); a new version of an asset tells assignees of open items using it.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.179" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assets: typeof import("../../src/app/actions/assets");
let notify: typeof import("../../src/lib/workflows/assets-notify");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  assets = await loadAppModule(() => import("../../src/app/actions/assets"));
  notify = await loadAppModule(() => import("../../src/lib/workflows/assets-notify"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const node = async (name: string, mime: string) => (await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, mime_type, created_by, current_version) VALUES (${ws}, 'file', ${name}, ${`/${name}`}, ${mime}, ${owner!}, 2) RETURNING id`)[0]!.id as string;
  return { owner: owner!, member: member!, viewer: viewer!, ws, logo: await node("Logo.svg", "image/svg+xml"), notes: await node("notes.txt", "text/plain") };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("W7/W8: Colors and outside links saved by people who can change files; bad links refused; read back with the assets", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  assert.match(errorOf(await assets.saveAssetLibraryAction({ projectId: t.ws, colors: [{ name: "Ink", hex: "#141A1E" }] })), /Only people who can change files/);
  viewerId = t.member;
  assert.equal((await assets.saveAssetLibraryAction({ projectId: t.ws, colors: [{ name: "Ink", hex: "141a1e" }] })).success, true);
  assert.match(errorOf(await assets.saveAssetLibraryAction({ projectId: t.ws, outsideLinks: [{ id: "abcdef12", name: "Footage", url: "javascript:alert(1)", type: "footage" }] })), /https:\/\/ or http:\/\//);
  assert.equal((await assets.saveAssetLibraryAction({ projectId: t.ws, outsideLinks: [{ id: "abcdef12", name: "Footage day 1", url: "https://drive.example.com/f/1", type: "footage", tags: ["day-1"] }] })).success, true);
  const r = await assets.readAssetsAction(t.ws);
  assert.ok(r.success);
  assert.deepEqual(r.library, { colors: [{ name: "Ink", hex: "#141A1E" }], outsideLinks: [{ id: "abcdef12", name: "Footage day 1", url: "https://drive.example.com/f/1", type: "footage", tags: ["day-1"] }] }, "saving links kept the colors");
});

test("W5: a new version tells assignees of open items using the asset, not the saver, not done items, not plain files", async () => {
  const t = await workspace();
  const task = async (title: string, assignee: string, status = "todo") => (await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, assignee_id) VALUES (${t.ws}, ${title}, ${status}, 'medium', ${t.owner}, ${assignee}) RETURNING id`)[0]!.id as string;
  for (const id of [await task("Launch post", t.member), await task("Old post", t.viewer, "done"), await task("Own post", t.owner)]) await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${id}, ${t.logo}), (${id}, ${t.notes})`;
  await notify.notifyAssetNewVersion(t.ws, t.logo, 2, t.owner);
  await notify.notifyAssetNewVersion(t.ws, t.notes, 2, t.owner);
  await notify.notifyAssetNewVersion(t.ws, t.logo, 2, t.owner);
  const rows = await sql`SELECT user_id, title FROM user_notifications WHERE title LIKE 'New version of %' AND user_id IN (${t.owner}, ${t.member}, ${t.viewer})`;
  assert.deepEqual(rows.map((r) => [r.user_id === t.member, r.title]), [[true, "New version of Logo.svg"]], "once, to the open item's assignee");
});
