import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Plan B8.1a (report 37.3): programs and shifts in an Other organization.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.243" }) });

let pg: typeof import("../../src/app/actions/programs");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  pg = await loadAppModule(() => import("../../src/app/actions/programs"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("37.5 (B8.3a): programs with measures — hours from tagged checked-in shifts, sessions from meetings, typed numbers only once confirmed, history kept; private programs stay private", async () => {
  const [admin, owner, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, admin!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', title = 'WT Literacy Trust' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${admin!}, 'owner'), (${id}, ${owner!}, 'member'), (${id}, ${member!}, 'member')`;
  const brief = { change: "Children don't read", reality: "Weekly reading", whyNow: "Libraries closed", mission: "Literacy", serves: "Children 6-10", howWeKnow: "Sessions and reading" };
  const input = { title: "WT Reading circles", aim: "Children read weekly", place: "Whitefield", start: null, end: null, goal: "Children's literacy", ownerId: owner!, public: false, brief,
    measures: [{ id: "hours", name: "Volunteer hours", source: "hours" as const, target: 300 }, { id: "sessions", name: "Sessions held", source: "sessions" as const, target: 50 },
      { id: "reading", name: "Children reading weekly", source: "typed" as const, target: 80 }] };
  viewerId = member!;
  assert.equal((await pg.startProgramAction(id, input)).success, false, "admins start programs");
  viewerId = admin!;
  const made = await pg.startProgramAction(id, input);
  assert.ok(made.success, JSON.stringify(made));
  const prog = made.success ? made.id : "";
  const [w] = await sql`SELECT parent_id, owner_id, visibility, org_settings->'program'->>'state' AS state FROM workspaces WHERE id = ${prog}`;
  assert.deepEqual([w!.parent_id, w!.owner_id, w!.visibility, w!.state], [id, owner!, "private", "running"]);
  // A volunteer shift tagged to the program, checked in: its hours count (X2's confirmed hours).
  const [t] = await sql`INSERT INTO tasks (workspace_id, title, item_type, stage, status, type_fields, creator_id, task_number)
    VALUES (${id}, 'Reading', 'event', 'confirmed', 'todo', ${sql.json({ kind: "shift", roleId: "reading", place: "", note: "", programId: prog, start: "2026-01-10T09:00:00Z", end: "2026-01-10T11:30:00Z" })}, ${admin!}, 9501) RETURNING id`;
  await sql`INSERT INTO community_events (task_id, workspace_id, place_limit) VALUES (${t!.id}, ${id}, 4)`;
  await sql`INSERT INTO community_rsvps (task_id, user_id, workspace_id, state, checked_in_at) VALUES (${t!.id}, ${member!}, ${id}, 'going', now()), (${t!.id}, ${owner!}, ${id}, 'going', NULL)`;
  await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${prog}, 'circle-1', 'Circle 1.md', ${sql.json({ section: "meetings", kind: "blank", finishedAt: new Date().toISOString() })}),
    (${prog}, 'circle-2', 'Circle 2.md', ${sql.json({ section: "meetings", kind: "blank" })})`;
  viewerId = member!;
  assert.equal((await pg.readProgramsAction(id) as { programs?: unknown[] }).programs?.length, 0, "a private program reaches only its people and admins");
  assert.equal((await pg.typeNumberAction(id, prog, "reading", 60)).success, false, "only its owner or admins type numbers");
  viewerId = owner!;
  assert.match(String((await pg.typeNumberAction(id, prog, "hours", 10) as { error?: string }).error), /count themselves/);
  assert.ok((await pg.typeNumberAction(id, prog, "reading", 64)).success);
  const before = await pg.readProgramsAction(id);
  const m = (r: typeof before, k: string) => (r.success ? r.programs[0]!.measures.find((x) => x.id === k) : null);
  assert.deepEqual([m(before, "hours")?.value, m(before, "sessions")?.value, m(before, "reading")?.value, m(before, "reading")?.waiting], [2.5, 1, null, true], "a typed number waits; hours and sessions count themselves");
  viewerId = admin!;
  const waiting = await pg.readProgramsAction(id);
  assert.ok(waiting.success && waiting.waiting.length === 1 && waiting.waiting[0]!.value === 64);
  assert.ok((await pg.confirmNumberAction(id, waiting.waiting[0]!.id, true)).success);
  viewerId = owner!;
  assert.ok((await pg.typeNumberAction(id, prog, "reading", 70)).success, "a change after confirmation waits again");
  const after = await pg.readProgramsAction(id);
  assert.deepEqual([m(after, "reading")?.value, m(after, "reading")?.waiting], [64, true], "reports keep the confirmed number until the new one is confirmed");
  assert.equal((await sql`SELECT count(*)::int AS n FROM program_numbers WHERE program_id = ${prog}`)[0]!.n, 2, "every value is kept as history");
  const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'program_numbers'`).map((c) => String(c.column_name));
  assert.ok(!cols.some((c) => /name|age|address|person|beneficiar/.test(c)), "no field for an individual served person");
  viewerId = admin!;
  assert.ok((await pg.setProgramStateAction(id, prog, "closed", "Moved to the library")).success);
});

test("37.5 (B8.3b): a story publishes only with everyone's consent, withdrawing unpublishes it; About and the impact report show only confirmed numbers", async () => {
  const [admin, owner, ravi, visitor] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, admin!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'other', status = 'active', title = 'WT Food Trust' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${admin!}, 'owner'), (${id}, ${owner!}, 'member'), (${id}, ${ravi!}, 'member')`;
  viewerId = admin!;
  const brief = { change: "", reality: "", whyNow: "", mission: "", serves: "Families", howWeKnow: "" };
  const made = await pg.startProgramAction(id, { title: "WT Winter food drive", aim: "Families eat through winter", place: "", start: "2026-01-01", end: null, goal: "Food security", ownerId: owner!, public: true, brief,
    measures: [{ id: "families", name: "Families served", source: "typed", target: 250 }, { id: "meals", name: "Meals cooked", source: "typed", target: null }] });
  assert.ok(made.success);
  const prog = made.success ? made.id : "";
  viewerId = owner!;
  assert.ok((await pg.typeNumberAction(id, prog, "families", 180)).success);
  assert.ok((await pg.typeNumberAction(id, prog, "meals", 900)).success);
  viewerId = admin!;
  const w = await pg.readProgramsAction(id);
  assert.ok((await pg.confirmNumberAction(id, (w.success ? w.waiting : []).find((x) => x.value === 180)!.id, true)).success);
  viewerId = owner!;
  const story = await pg.saveStoryAction(id, prog, { headline: "A warm kitchen", body: "Ravi and Mrs Rao cooked for 40 families.", people: [{ name: "Ravi", memberId: ravi! }, { name: "Mrs Rao", memberId: null }] });
  assert.ok(story.success);
  const sid = story.success ? story.id : "";
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${ravi!} AND title LIKE 'You’re named in a story%'`)[0]!.n, 1, "a member named is asked");
  assert.match(String((await pg.publishStoryAction(id, sid) as { error?: string }).error), /yes first/, "a story without consent can't be published");
  assert.equal((await pg.setStoryConsentAction(id, sid, 0, { give: true })).success, false, "the owner can't give a member's yes for them");
  assert.ok((await pg.setStoryConsentAction(id, sid, 1, { give: true, by: "Mrs Rao", at: "2026-11-20" })).success, "the owner records an outside person's yes");
  viewerId = ravi!;
  assert.equal((await pg.setStoryConsentAction(id, sid, 1, { give: false })).success, false);
  assert.ok((await pg.setStoryConsentAction(id, sid, 0, { give: true })).success);
  viewerId = owner!;
  assert.ok((await pg.publishStoryAction(id, sid)).success);
  viewerId = visitor!;
  const about = await pg.readOurProgramsAction(id);
  assert.ok(about.success && about.programs.length === 1);
  assert.deepEqual(about.programs[0]!.measures, [{ name: "Families served", value: 180, target: 250 }], "only confirmed numbers reach About");
  assert.equal(about.programs[0]!.stories[0]!.headline, "A warm kitchen");
  viewerId = ravi!;
  assert.ok((await pg.setStoryConsentAction(id, sid, 0, { give: false })).success);
  assert.equal((await sql`SELECT state FROM program_stories WHERE id = ${sid}`)[0]!.state, "draft", "withdrawn consent unpublishes it at once");
  viewerId = visitor!;
  assert.equal((await pg.readOurProgramsAction(id) as { programs: Array<{ stories: unknown[] }> }).programs[0]!.stories.length, 0);
  viewerId = admin!;
  const report = await pg.readImpactReportAction(id, new Date().getFullYear());
  assert.ok(report.success && report.markdown.includes("- Families served: 180 of 250") && report.markdown.includes("- Meals cooked: not yet confirmed") && !report.markdown.includes("Finances"));
});
