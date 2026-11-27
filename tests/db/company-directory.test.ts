import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.2a–b (report 33.3): the company Directory — no email or phone, Viewers only if allowed (names and titles),
// my own card fields, Reports to with loops refused, Away until without the reason.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.235" }) });

let people: typeof import("../../src/app/actions/company-people");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  people = await loadAppModule(() => import("../../src/app/actions/company-people"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("33.3: every member reads the Directory (never an email); Viewers only if allowed; Reports to refuses loops", async () => {
  const [owner, dev, ana, guest, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, title) VALUES (${id}, ${owner!}, 'owner', 'CEO'), (${id}, ${dev!}, 'member', 'Backend engineer'), (${id}, ${ana!}, 'admin', 'Head of Engineering'), (${id}, ${guest!}, 'viewer', null)`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()}, org_settings = ${sql.json({ company: { offices: [{ name: "London", city: "London", zone: "Europe/London" }] } })} WHERE id = ${id}`;
  await sql`UPDATE profiles SET skills = '["Postgres","Go"]'::jsonb WHERE id = ${dev!}`;
  await sql`INSERT INTO org_member_away (org_id, user_id, starts_at, ends_at, reason) VALUES (${id}, ${dev!}, now() - interval '1 day', now() + interval '3 days', 'Surgery')`;

  viewerId = dev!;
  assert.match((await people.saveMyDirectoryAction(id, { zone: "Mars/Base", hours: null, office: null }) as { error: string }).error, /time zone/);
  assert.match((await people.saveMyDirectoryAction(id, { zone: "Europe/London", hours: { from: "18:00", to: "09:00" }, office: null }) as { error: string }).error, /end after/);
  assert.equal((await people.saveMyDirectoryAction(id, { zone: "Europe/London", hours: { from: "09:00", to: "17:30" }, office: "London" })).success, true);
  const dir = await people.readDirectoryAction(id);
  assert.ok(dir.success && !dir.limited);
  const me = dir.people.find((p) => p.id === dev!) as { zone: string; office: string; askMeAbout: string[]; awayNow: boolean; awayUntil: string | null };
  assert.deepEqual([me.zone, me.office, me.askMeAbout, me.awayNow, Boolean(me.awayUntil)], ["Europe/London", "London", ["Postgres", "Go"], true, true]);
  const text = JSON.stringify(dir);
  assert.equal(/@|email|phone|Surgery/i.test(text), false, "no email, phone or away reason anywhere");
  assert.equal(dir.people.some((p) => p.id === guest!), false, "Viewers aren't listed");

  viewerId = guest!;
  assert.equal((await people.readDirectoryAction(id)).success, false, "Viewers only when allowed");
  viewerId = owner!;
  assert.equal((await people.saveDirectorySettingsAction(id, { viewers: true })).success, true);
  viewerId = guest!;
  const limited = await people.readDirectoryAction(id);
  assert.ok(limited.success && limited.limited);
  assert.deepEqual(Object.keys(limited.people[0]!).sort(), ["id", "name", "title"], "names and titles only");
  viewerId = outsider!;
  assert.equal((await people.readDirectoryAction(id)).success, false, "outside people see no directory");

  viewerId = dev!;
  assert.equal((await people.setReportsToAction(id, dev!, ana!)).success, false, "admins set Reports to");
  viewerId = ana!;
  assert.equal((await people.setReportsToAction(id, dev!, ana!)).success, true);
  assert.equal((await people.setReportsToAction(id, ana!, owner!)).success, true);
  assert.match((await people.setReportsToAction(id, owner!, dev!) as { error: string }).error, /can’t report to someone who reports to/);
  assert.match((await people.setReportsToAction(id, dev!, guest!) as { error: string }).error, /people in the company/);
  const after = await people.readDirectoryAction(id);
  assert.ok(after.success && !after.limited);
  assert.equal((after.people.find((p) => p.id === dev!) as { reportsTo: string }).reportsTo, ana!);
  // Counts (call 8): admins only, numbers only.
  viewerId = dev!;
  assert.equal((await people.readPeopleCountsAction(id)).success, false);
  viewerId = owner!;
  const counts = await people.readPeopleCountsAction(id);
  assert.ok(counts.success);
  assert.equal(counts.total, 3);
  assert.deepEqual(counts.offices.find((o) => o.name === "London")?.n, 1);
  assert.equal(/Dev|Ana|Khan/.test(JSON.stringify(counts)), false, "never a name");
  // The person and the line managers are told; whoever made the change isn't told about their own change.
  const notes = await sql`SELECT user_id FROM user_notifications WHERE user_id IN (${dev!}, ${owner!}) AND title LIKE ${"% now reports to %"}`;
  assert.equal(new Set(notes.map((n) => n.user_id)).size, 2);
});

test("33.3 call 5 (B4.2c): book time off with a type; others see Away; the type reaches the person, their line manager and admins; cancel my own", async () => {
  const [owner, dev, ana, kai, viewer] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${dev!}, 'member'), (${id}, ${ana!}, 'member'), (${id}, ${kai!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()}, time_zone = 'Asia/Kolkata',
    org_settings = ${sql.json({ staffGrowth: { reportsTo: { [dev!]: ana! } }, directory: { timeOffTypes: { vacation: "Holiday" } } })} WHERE id = ${id}`;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  viewerId = dev!;
  assert.match(String((await people.bookTimeOffAction(id, { from: day(3), to: day(1), type: "vacation" }) as { error?: string }).error), /before the first/);
  assert.match(String((await people.bookTimeOffAction(id, { from: day(-5), to: day(3), type: "vacation" }) as { error?: string }).error), /from today/, "security review: no backdating to excuse work already due");
  assert.equal((await people.bookTimeOffAction(id, { from: day(2), to: day(4), type: "bogus" as never })).success, false);
  assert.ok((await people.bookTimeOffAction(id, { from: day(2), to: day(4), type: "vacation" })).success);
  const label = async (who: string) => { viewerId = who; const r = await people.readWhosOutAction(id); assert.ok(r.success); return r.out.find((o) => o.person === dev!)?.label; };
  assert.equal(await label(dev!), "Holiday", "the person sees the type, renamed");
  assert.equal(await label(ana!), "Holiday", "their line manager does");
  assert.equal(await label(owner!), "Holiday", "admins do");
  assert.equal(await label(kai!), "Away", "everyone else reads Away");
  viewerId = viewer!;
  assert.equal((await people.readWhosOutAction(id)).success, false, "Viewers don't see Who's out");
  assert.equal((await people.bookTimeOffAction(id, { from: day(2), to: day(4), type: "sick" })).success, false, "nor book time off");
  const row = (await sql`SELECT id, type, reason FROM org_member_away WHERE org_id = ${id} AND user_id = ${dev!}`)[0]!;
  assert.deepEqual([row.type, row.reason], ["vacation", null], "a type, never a reason");
  viewerId = kai!;
  assert.equal((await people.cancelTimeOffAction(id, row.id as string)).success, false, "only my own");
  viewerId = dev!;
  assert.ok((await people.cancelTimeOffAction(id, row.id as string)).success);
  assert.equal((await sql`SELECT count(*)::int AS n FROM org_member_away WHERE org_id = ${id}`)[0]!.n, 0, "time off still to come is removed");

  // Security review: booking excuses my work due then; cancelling makes it due again; an admin's Mark away isn't mine to cancel.
  const [m] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_settings, creator_id) VALUES (${id}, 'WT report', 'assignment', ${sql.json({})}, ${owner!}) RETURNING id`;
  const [c] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${id}, 'WT report', 'task', ${m!.id}, ${dev!}, ${owner!}, now() + interval '3 days') RETURNING id`;
  const booked = await people.bookTimeOffAction(id, { from: day(2), to: day(4), type: "sick" });
  assert.ok(booked.success && booked.excused === 1);
  const again = (await sql`SELECT id FROM org_member_away WHERE org_id = ${id} AND user_id = ${dev!}`)[0]!.id as string;
  assert.ok((await people.cancelTimeOffAction(id, again)).success);
  assert.equal((await sql`SELECT excused_at FROM tasks WHERE id = ${c!.id}`)[0]!.excused_at, null, "the work is due again");
  await sql`INSERT INTO org_member_away (org_id, user_id, starts_at, ends_at, created_by) VALUES (${id}, ${dev!}, now() + interval '5 days', now() + interval '6 days', ${owner!})`;
  const admins = (await sql`SELECT id FROM org_member_away WHERE org_id = ${id} AND user_id = ${dev!}`)[0]!.id as string;
  assert.equal((await people.cancelTimeOffAction(id, admins)).success, false, "an admin's Mark away isn't cancelled by the member");
  viewerId = owner!;
  assert.ok((await people.saveDirectorySettingsAction(id, { typeNames: { sick: "Unwell" } })).success);
  const s = (await sql`SELECT org_settings->'directory' AS d, org_settings->'staffGrowth' AS g FROM workspaces WHERE id = ${id}`)[0]!;
  assert.deepEqual(s.d, { timeOffTypes: { sick: "Unwell" } });
  assert.ok(s.g, "saving the directory keeps other settings");
  assert.ok((await people.saveDirectorySettingsAction(id, { viewers: true })).success);
  assert.deepEqual((await sql`SELECT org_settings->'directory' AS d FROM workspaces WHERE id = ${id}`)[0]!.d, { timeOffTypes: { sick: "Unwell" }, viewers: true }, "viewers and type names merge");
});

