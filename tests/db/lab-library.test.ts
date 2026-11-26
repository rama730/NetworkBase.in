import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.4a (report 35.4): the lab Library — members only; a duplicate paste finds the existing source; reading states and
// private notes never reach anyone else (server test); themes from the lab's list; a source a thesis links stays.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.251" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let li: typeof import("../../src/app/actions/lab-library");
let lab: typeof import("../../src/app/actions/lab");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  li = await loadAppModule(() => import("../../src/app/actions/lab-library"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.4: library for members; duplicates found; my reading stays mine; themes; linked sources stay", async () => {
  const [pi, researcher, student, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${researcher!}, 'admin'), (${org}, ${student!}, 'member'), (${org}, ${viewer!}, 'viewer')`;
  const src = (title: string, doi: string | null = null) => ({ title, authors: "Rao; Lin", year: 2022, venue: "CVPR", link: null, doi });

  viewerId = outsider!;
  assert.equal((await li.readLibraryAction(org)).success, false, "never for outsiders");
  viewerId = viewer!;
  assert.equal((await li.readLibraryAction(org)).success, false, "nor Viewers");
  viewerId = student!;
  const add = await li.addSourcesAction(org, [src("NeRF in the Dark", "10.1/nerf"), src("Zero-DCE")]);
  assert.ok(add.success && add.added === 2);
  const again = await li.addSourcesAction(org, [src("nerf in the dark!"), src("Other title", "10.1/NERF"), src("New one")]);
  assert.ok(again.success && again.added === 1 && again.already.length === 2, "a duplicate paste finds the existing source (title or DOI)");
  const lib = await li.readLibraryAction(org);
  const nerf = lib.success ? lib.rows.find((r) => r.title === "NeRF in the Dark")! : null;
  assert.ok(nerf);

  // Call 3: reading states and private notes are only ever the person's.
  assert.ok((await li.setMyReadingAction(org, nerf!.id, { state: "reading", note: "secret thoughts" })).success);
  viewerId = researcher!;
  const other = await li.readSourceAction(org, nerf!.id);
  assert.ok(other.success && other.mine === null, "another member never sees my state or note");
  const otherLib = await li.readLibraryAction(org, { mine: true });
  assert.ok(otherLib.success && otherLib.rows.length === 0);
  const card = await li.readLibraryCardAction(org);
  assert.ok(card.success && card.reading === 0, "the card counts only my own list");
  viewerId = student!;
  const mine = await li.readSourceAction(org, nerf!.id);
  assert.ok(mine.success && mine.mine?.state === "reading" && mine.mine.note === "secret thoughts");

  // Lab notes are signed; Extracted once I read it and wrote notes.
  assert.ok((await li.saveLabNoteAction(org, nerf!.id, { section: "findings", body: "Works at 0.1 lux." })).success);
  assert.ok((await li.setMyReadingAction(org, nerf!.id, { state: "read", note: "" })).success);
  const after = await li.readLibraryAction(org);
  const row = after.success ? after.rows.find((r) => r.id === nerf!.id) : null;
  assert.equal(row?.iWroteNotes, true);
  assert.equal(row?.myState, "read");
  assert.equal(row?.notesBy.length, 1);

  // Themes come from the lab's list (Settings → Lab).
  assert.match(String((await li.setSourceThemeAction(org, nerf!.id, { theme: "Low-light", on: true, disagrees: false, why: "" }) as { error?: string }).error), /lab’s themes/);
  viewerId = pi!;
  const settings = await lab.readLabSettingsAction(org);
  assert.ok(settings.success);
  assert.ok((await lab.saveLabSettingsAction(org, { ...settings.settings, themes: ["Low-light", "3D scenes"] })).success);
  viewerId = student!;
  assert.ok((await li.setSourceThemeAction(org, nerf!.id, { theme: "Low-light", on: true, disagrees: true, why: "Different sensor" })).success);
  const themed = await li.readLibraryAction(org);
  assert.deepEqual(themed.success ? themed.themeRows : null, [{ theme: "Low-light", count: 1, thin: true, disagrees: 1 }, { theme: "3D scenes", count: 0, thin: true, disagrees: 0 }]);

  // Edits: whoever added it, the PI and Researchers; a thesis link keeps it in the library.
  viewerId = researcher!;
  assert.ok((await li.editSourceAction(org, nerf!.id, { ...src("NeRF in the Dark", "10.1/nerf"), code: true, data: false })).success);
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${ws}`;
  await sql`INSERT INTO literature_sources (workspace_id, title, lab_source_id) VALUES (${ws}, 'NeRF in the Dark', ${nerf!.id})`;
  assert.match(String((await li.removeSourceAction(org, nerf!.id) as { error?: string }).error), /thesis links this source/);
  const zero = lib.success ? lib.rows.find((r) => r.title === "Zero-DCE")! : null;
  viewerId = student!;
  assert.ok((await li.removeSourceAction(org, zero!.id)).success, "the person who added it removes it");
  // Security review: the thesis Literature actions never reach the lab's own sources.
  const lit = await loadAppModule(() => import("../../src/app/actions/literature"));
  assert.equal((await lit.readLiteratureAction(org)).success, false);
    // Nothing reaches the public About.
  viewerId = "";
  const about = await lab.readLabAboutAction(org);
  assert.ok(about.success && !JSON.stringify(about).includes("NeRF"));
});
