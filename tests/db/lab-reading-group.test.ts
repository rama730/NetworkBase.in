import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.4b (report 35.4): the reading group — the rotation skips Away people (server test); a swap needs the other person's
// yes and gives them back their next session; one Read before per session; notices claimed once an hour.
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
let rg: typeof import("../../src/app/actions/lab-reading-group");
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
  rg = await loadAppModule(() => import("../../src/app/actions/lab-reading-group"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.4 reading group: rotation skips Away; swaps need a yes; one Read before; presenter picks; notices once", async () => {
  const [pi, ravi, meera, arjun, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active', time_zone = 'Asia/Kolkata' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${ravi!}, 'member'), (${org}, ${meera!}, 'member'), (${org}, ${arjun!}, 'member')`;
  // Meera is Away for the next two weeks, so the rotation passes her by.
  await sql`INSERT INTO org_member_away (org_id, user_id, starts_at, ends_at) VALUES (${org}, ${meera!}, now(), now() + interval '15 days')`;

  viewerId = ravi!;
  assert.equal((await rg.saveReadingGroupAction(org, { on: true, weekday: 2, time: "16:00", order: [ravi!, meera!, arjun!], pickDays: 3 })).success, false, "only the PI and Researchers set it up");
  viewerId = pi!;
  assert.match(String((await rg.saveReadingGroupAction(org, { on: true, weekday: 2, time: "16:00", order: [ravi!, outsider!], pickDays: 3 }) as { error?: string }).error), /people in the lab/);
  assert.ok((await rg.saveReadingGroupAction(org, { on: true, weekday: 2, time: "16:00", order: [ravi!, meera!, arjun!], pickDays: 3 })).success);
  const read = await rg.readReadingGroupAction(org);
  assert.ok(read.success);
  const ups = read.success ? read.upcoming : [];
  assert.equal(ups.length, 4);
  assert.deepEqual(ups.slice(0, 2).map((s) => s.presenter?.id), [ravi!, arjun!], "Meera is skipped while Away");
  viewerId = outsider!;
  assert.equal((await rg.readReadingGroupAction(org)).success, false);

  // The presenter picks; one Read before goes to the lab, even when the paper changes.
  viewerId = ravi!;
  const add = await li.addSourcesAction(org, [{ title: "NeRF in the Dark", authors: null, year: 2022, venue: null, link: null, doi: null }, { title: "Zero-DCE", authors: null, year: 2020, venue: null, link: null, doi: null }]);
  assert.ok(add.success);
  const lib = await li.readLibraryAction(org);
  const [s1, s2] = lib.success ? [lib.rows[1]!.id, lib.rows[0]!.id] : ["", ""];
  viewerId = arjun!;
  assert.equal((await rg.pickReadingAction(org, ups[0]!.id, s1)).success, false, "only the presenter (or a lead) picks");
  viewerId = ravi!;
  assert.ok((await rg.pickReadingAction(org, ups[0]!.id, s1)).success);
  assert.ok((await rg.pickReadingAction(org, ups[0]!.id, s2)).success);
  const [notes] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE dedupe_key LIKE ${`lab-read-before:${ups[0]!.id}:%`}`;
  assert.equal(notes!.n, 3, "one Read before per member (not the picker), however often the paper changes");
  assert.ok((await rg.suggestSourceAction(org, s1, true)).success);

  // Swap with Arjun: needs his yes; he takes session 1, Ravi takes Arjun's next.
  assert.ok((await rg.askSwapAction(org, ups[0]!.id, arjun!)).success);
  assert.match(String((await rg.askSwapAction(org, ups[0]!.id, pi!) as { error?: string }).error), /already waiting/);
  const [swap] = await sql`SELECT id FROM lab_reading_swaps WHERE session_id = ${ups[0]!.id} AND state = 'asked'`;
  assert.equal((await rg.answerSwapAction(org, swap!.id, true)).success, false, "only the person asked answers");
  viewerId = arjun!;
  assert.ok((await rg.answerSwapAction(org, swap!.id, true)).success);
  const [a, b] = await sql`SELECT presenter_id FROM lab_reading_sessions WHERE id IN (${ups[0]!.id}, ${ups[1]!.id}) ORDER BY starts_at`;
  assert.equal(a!.presenter_id, arjun!);
  assert.equal(b!.presenter_id, ravi!);

  // Finishing waits for the session to start; notes go to the source's lab notes.
  assert.match(String((await rg.finishReadingAction(org, ups[0]!.id, "Good discussion") as { error?: string }).error), /once it has started/);
  await sql`UPDATE lab_reading_sessions SET starts_at = now() - interval '1 hour' WHERE id = ${ups[0]!.id}`;
  assert.ok((await rg.finishReadingAction(org, ups[0]!.id, "Good discussion")).success);
  assert.ok((await rg.addSessionToLabNotesAction(org, ups[0]!.id)).success);
  const [note] = await sql`SELECT body FROM lab_source_notes WHERE source_id = ${s2} AND section = 'findings'`;
  assert.match(String(note?.body), /Reading group, .*: Good discussion/);

  // Notices: the hourly job claims each one once.
  const server = await loadAppModule(() => import("../../src/lib/organizations/lab-reading-group-server"));
  await sql`UPDATE lab_reading_sessions SET starts_at = now() + interval '3 days 12 hours' WHERE id = ${ups[1]!.id}`;
  await sql`UPDATE lab_reading_sessions SET source_id = NULL WHERE id = ${ups[1]!.id}`;
  const first = await server.readingGroupNotices(new Date());
  const second = await server.readingGroupNotices(new Date());
  assert.ok(first.sent >= 2, "next presenter and pick by tomorrow");
  assert.equal(second.sent, 0, "never twice");
});
