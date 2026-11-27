import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Plan B8.1a (report 37.3): org-parts and shifts in an Other organization.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.244" }) });

let op: typeof import("../../src/app/actions/org-parts");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  op = await loadAppModule(() => import("../../src/app/actions/org-parts"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("37.2 (B8.4a): parts switch on and off from Settings → Workflows; off hides the part and keeps its data; on twice is refused; Add from a kit", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, {}));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  const v = await loadAppModule(() => import("../../src/app/actions/volunteers"));
  viewerId = member!;
  assert.equal((await op.readPartsAction(id)).success, false, "owner and admins only");
  viewerId = owner!;
  assert.equal((await v.readVolunteersAction(id)).success, false, "a part that's off shows nothing");
  const parts = await op.readPartsAction(id);
  assert.ok(parts.success && parts.parts.every((p) => p.ready && !p.on) && parts.parts.map((p) => p.id).join() === "volunteers,fixedTime,programs,events,boardMeetings");
  assert.ok((await op.setPartAction(id, "volunteers", true)).success);
  assert.match(String((await op.setPartAction(id, "volunteers", true) as { error?: string }).error), /already on/);
  assert.equal((await op.setPartAction(id, "renewal", true)).success, false, "parts that don't work here yet aren't offered");
  assert.ok((await v.saveVolunteerSettingsAction(id, { on: true, agreement: { text: "", version: 0 }, roles: [{ id: "sorting", name: "Sorting", line: "", training: false }] })).success);
  const shift = await v.saveShiftAction(id, { roleId: "sorting", place: "", start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString(), places: 3, note: "" });
  assert.ok(shift.success);
  assert.ok((await op.setPartAction(id, "volunteers", false)).success);
  assert.equal((await v.readVolunteersAction(id)).success, false, "off hides it");
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${id} AND type_fields->>'kind' = 'shift'`)[0]!.n, 1, "and keeps its data");
  const off = await op.readPartsAction(id);
  assert.ok(off.success && off.parts.find((p) => p.id === "volunteers")!.hasData);
  assert.ok((await op.setPartAction(id, "volunteers", true)).success);
  const back = await v.readVolunteersAction(id);
  assert.ok(back.success && "shifts" in back && back.shifts.length === 1, "on again brings everything back");
  assert.equal((await op.addKitPartsAction(id, "association")).success, false, "a kit is added only once all its parts work here");
  const kit = await op.addKitPartsAction(id, "nonprofit");
  assert.ok(kit.success && kit.added === 3, "Add from a kit switches on the parts not on yet");
});

test("37.2 (B8.5): the Nonprofit kit — events and board meetings work in an Other organization once their parts are on", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, {}));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  const ev = await loadAppModule(() => import("../../src/app/actions/community-events"));
  const docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  const board = await loadAppModule(() => import("../../src/app/actions/board-meetings"));
  viewerId = owner!;
  assert.equal((await ev.readCommunityEventsAction(id, "upcoming")).success, false, "Events is off until its part is on");
  assert.ok((await op.addKitPartsAction(id, "nonprofit")).success);
  const start = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const saved = await ev.saveCommunityEventAction(id, null, { title: "WT Volunteer fair", description: null, link: null, placeLimit: 20,
    fields: { kind: "community", start, end: new Date(Date.parse(start) + 7_200_000).toISOString(), format: "in_person", place: "Hall", who: "members", hosts: [], runOfShow: [] } });
  assert.ok(saved.success, JSON.stringify(saved));
  viewerId = member!;
  assert.ok((await ev.rsvpCommunityEventAction(id, saved.success ? saved.id : "", { choice: "going", private: false })).success, "members RSVP");
  viewerId = owner!;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${id}, 'file', 'board-1.md', '/board-1.md', ${owner!}) RETURNING id`;
  await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${id}, ${node!.id}, 'board-1', 'board-1.md', ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })})`;
  const made = await docs.createMeetingAction(id, { docSlug: "board-1", type: "board", title: "Board · Jan", startsAt: new Date(Date.now() + 86_400_000).toISOString(), lengthMinutes: 60, attendeeIds: [owner!, member!], repeat: "none", boardSize: 3 });
  assert.ok(made.success, JSON.stringify(made));
  viewerId = member!;
  const list = await board.readBoardMeetingsAction(id);
  assert.ok(list.success && list.meetings.length === 1 && list.meetings[0]!.title === "Board · Jan" && !list.canPlan);
});
