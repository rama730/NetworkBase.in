import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §26 pass: due today, digest Needs your attentionr attention, derived Needs your attentionr attention rows, org sprint notices, code and cap notices,
// lead handover, and a child project's own notification setting winning over the org mute.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
process.env.RESEND_EMAIL_ENABLED = "true";

let digests: typeof import("../../src/lib/organizations/org-digests");
let needsYou: typeof import("../../src/lib/organizations/needs-you");
let sprintNotify: typeof import("../../src/lib/organizations/sprint-notify");
let schedule: typeof import("../../src/lib/projects/sprint-schedule");
let orgs: typeof import("../../src/app/actions/organizations");
let children: typeof import("../../src/lib/organizations/children");
let succession: typeof import("../../src/lib/organizations/succession");
let events: typeof import("../../src/lib/notifications/project-events");
let appDb: typeof import("../../src/lib/db");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  digests = await loadAppModule(() => import("../../src/lib/organizations/org-digests"));
  needsYou = await loadAppModule(() => import("../../src/lib/organizations/needs-you"));
  sprintNotify = await loadAppModule(() => import("../../src/lib/organizations/sprint-notify"));
  schedule = await loadAppModule(() => import("../../src/lib/projects/sprint-schedule"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  children = await loadAppModule(() => import("../../src/lib/organizations/children"));
  succession = await loadAppModule(() => import("../../src/lib/organizations/succession"));
  events = await loadAppModule(() => import("../../src/lib/notifications/project-events"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM email_outbox WHERE project_id = ${id}`;
    await sql`DELETE FROM projects WHERE id = ${id} OR parent_id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE profiles SET notification_preferences = ${sql.json({ quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "UTC" } })} WHERE id IN (${owner!}, ${admin!}, ${a!}, ${b!})`;
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A', time_zone = 'UTC', slug = ${`cse-${id.slice(0, 8)}`} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function child(orgId: string, lead: string, title = "Compiler Lab") {
  const id = await sql.begin((tx) => createProject(tx, lead));
  await sql`UPDATE projects SET parent_id = ${orgId}, title = ${title} WHERE id = ${id}`;
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${lead}, 'owner')`;
  return id;
}

async function sprint(projectId: string, values: { name: string; status: string; start: Date; end: Date; parent?: string | null; autoStart?: boolean }) {
  const [row] = await sql`INSERT INTO project_sprints (project_id, sprint_number, name, status, start_date, end_date, parent_sprint_id, auto_start)
    VALUES (${projectId}, (SELECT coalesce(max(sprint_number), 0) + 1 FROM project_sprints WHERE project_id = ${projectId}), ${values.name}, ${values.status},
      ${values.start}, ${values.end}, ${values.parent ?? null}, ${values.autoStart ?? true}) RETURNING id`;
  return row!.id as string;
}

const DAY = 86_400_000;
const tray = (userId: string) => sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${userId} ORDER BY created_at`;
const titles = async (userId: string) => (await tray(userId)).map((r) => r.title);
const viewerFor = (o: { id: string }, userId: string, isAdmin: boolean) =>
  ({ userId, isAdmin, isInside: true, isGuest: false, access: null, org: { id: o.id, title: "CSE-3A", slug: null, status: "active" } }) as never;

test("due today: a tray line at 9:00 local on the due day, once", async () => {
  const o = await org();
  const now = new Date(); now.setUTCHours(9, 15, 0, 0);
  const due = new Date(now); due.setUTCHours(23, 59, 0, 0);
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.a}, ${o.owner}, ${due})`;
  await digests.runOrgDueSoon(now);
  await digests.runOrgDueSoon(now);
  assert.deepEqual((await titles(o.a)).filter((t) => t.includes("due today")), ["Lab 1 is due today at 11:59 PM"]);
});

test("Needs your attentionr attention: late joiners outside a team, members outside projects, a blocked sprint; the digest carries them and sprints ending tomorrow", async () => {
  const o = await org();
  const now = new Date(); now.setUTCHours(8, 10, 0, 0);
  const published = new Date(now.getTime() - 2 * DAY).toISOString();
  const settings = (target: unknown) => sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target, publishedAt: published, closedAt: null });
  await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES
    (${o.id}, 'Lab 2', 'assignment', ${o.owner}, ${settings({ mode: "teams", teams: [], individuals: [] })}),
    (${o.id}, 'Proposal', 'assignment', ${o.owner}, ${settings({ mode: "each_child" })})`;
  await child(o.id, o.a);
  await sql`UPDATE project_members SET joined_at = now() WHERE project_id = ${o.id} AND user_id = ${o.b}`;
  const active = await sprint(o.id, { name: "CO1", status: "active", start: new Date(now.getTime() - 5 * DAY), end: new Date(now.getTime() + DAY) });
  await sprint(o.id, { name: "CO2", status: "planning", start: new Date(now.getTime() - DAY), end: new Date(now.getTime() + 9 * DAY) });
  void active;

  const rows = await needsYou.readNeedsYou(viewerFor(o, o.owner, true), now);
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes("2 new members not in a team · Lab 2"), labels.join(" | "));
  assert.ok(labels.includes("1 member not in a project"), labels.join(" | "));
  assert.ok(labels.includes("CO2 couldn’t start: CO1 is still active"), labels.join(" | "));

  await digests.runOrgAdminDigest(now);
  const [mail] = await sql`SELECT data FROM email_outbox WHERE project_id = ${o.id} AND kind = 'org_digest' LIMIT 1`;
  const lines = (mail!.data as { digest: { needsYou: string[] } }).digest.needsYou;
  assert.ok(lines.includes("CO1 ends tomorrow"), lines.join(" | "));
  assert.ok(lines.includes("CO2 couldn’t start: CO1 is still active"));

  // Auto-start finds CO2 blocked: admins hear once.
  await schedule.startDueSprints(now, 100, o.id);
  await schedule.startDueSprints(now, 100, o.id);
  assert.equal((await titles(o.admin)).filter((t) => t === "CO2 couldn’t start: CO1 is still active").length, 1);
});

test("org sprints: start tells members and leads without a linked sprint; close gives each person their count; new dates warn linked leads", async () => {
  const o = await org();
  const lab = await child(o.id, o.a);
  const now = new Date();
  const co1 = await sprint(o.id, { name: "CO1", status: "planning", start: new Date(now.getTime() - DAY), end: new Date(now.getTime() + 7 * DAY) });
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, sprint_id, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, ${co1},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, publishedAt: now.toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, status) VALUES
    (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.a}, ${o.owner}, 'done'), (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.b}, ${o.owner}, 'todo')`;

  assert.equal(await schedule.startSprint(co1, o.id, now, o.owner, "manual"), true);
  assert.ok((await titles(o.b)).includes("CO1 started · 1 assignment"));
  assert.ok((await titles(o.a)).includes("CO1 started. Plan your sprint in Compiler Lab"));
  assert.ok((await needsYou.readNeedsYou(viewerFor(o, o.a, false), now)).some((r) => r.label === "CO1 started. Plan your sprint in Compiler Lab"));

  // The lead plans inside it; the org then narrows CO1 so the linked sprint no longer fits.
  await sprint(lab, { name: "Lab sprint 1", status: "active", start: new Date(now.getTime() - DAY), end: new Date(now.getTime() + 7 * DAY), parent: co1 });
  await sql`UPDATE project_sprints SET end_date = ${new Date(now.getTime() + 3 * DAY)}, updated_at = now() WHERE id = ${co1}`;
  await sprintNotify.notifyLinkedSprintsOutside(co1, o.id, o.owner);
  assert.ok((await titles(o.a)).includes("Your sprint Lab sprint 1 is outside CO1's new dates"));

  await sql`UPDATE project_sprints SET status = 'completed', completed_at = now() WHERE id = ${co1}`;
  assert.equal(await sprintNotify.notifyOrgSprintCompleted(co1, o.id, o.owner), true);
  assert.ok((await titles(o.a)).includes("CO1 closed · you completed 1 of 1"));
  assert.ok((await titles(o.b)).includes("CO1 closed · you completed 0 of 1"));
  assert.ok((await needsYou.readNeedsYou(viewerFor(o, o.a, false), now)).some((r) => r.label === "CO1 closed · Complete Lab sprint 1?"));
  // A plain project is left to the generic notice.
  assert.equal(await sprintNotify.notifyOrgSprintCompleted(co1, lab, o.owner), false);
});

test("a new join code tells the other admins; a tightened cap tells the lead and admins; a handover tells the new lead", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.ok((await orgs.regenerateJoinCodeAction(o.id)).success);
  viewerId = "";
  assert.ok((await titles(o.owner)).some((t) => t.startsWith("The join code was changed by")));
  assert.ok(!(await titles(o.admin)).some((t) => t.startsWith("The join code was changed")), "not the person who changed it");

  const lab = await child(o.id, o.a, "North region");
  await sql`UPDATE projects SET visibility = 'public' WHERE id = ${lab}`;
  await sql`UPDATE projects SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"visibilityCap":"org"}'::jsonb WHERE id = ${o.id}`;
  assert.equal(await children.applyChildVisibilityCap(o.id), 1);
  assert.ok((await titles(o.a)).includes("North region is now Organization because CSE-3A changed its rules"));
  assert.ok((await titles(o.admin)).includes("North region is now Organization because CSE-3A changed its rules"));

  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${lab}, ${o.b}, 'admin')`;
  await appDb.db.transaction((tx) => succession.handOverLedChildProjects(tx, o.a));
  await succession.notifyLeadHandovers(o.a);
  await succession.notifyLeadHandovers(o.a);
  assert.equal((await titles(o.b)).filter((t) => t === "You’re the lead of North region").length, 1);
});

test("a child project's own notification setting wins over the org's Off", async () => {
  const o = await org();
  const lab = await child(o.id, o.owner);
  await sql`INSERT INTO project_members (project_id, user_id, role, notification_preferences) VALUES
    (${lab}, ${o.a}, 'member', ${sql.json({ version: 1, mode: "custom", rules: {} })}), (${lab}, ${o.b}, 'member', ${sql.json({ version: 1, mode: "inherit", rules: {} })})`;
  const off = { organizations: { [o.id]: { level: "off", email: false, includeChildren: true } }, quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "UTC" } };
  await sql`UPDATE profiles SET notification_preferences = ${sql.json(off)} WHERE id IN (${o.a}, ${o.b})`;
  await events.enqueueProjectNotificationEvent({ projectId: lab, eventKey: "sprints.created", actorUserId: o.owner, title: "Sprint created: Lab 1", sourceEventId: `wins:${lab}` });
  assert.ok((await titles(o.a)).includes("Sprint created: Lab 1"), "custom child setting wins");
  assert.ok(!(await titles(o.b)).includes("Sprint created: Lab 1"), "inheriting members follow the org's Off");
});
