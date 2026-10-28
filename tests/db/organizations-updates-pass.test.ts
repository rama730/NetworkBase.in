import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §17 pass: org-feed pins for shared posts, Notify again, removal with a reason, the org's notify and reply
// defaults, the audience count, emailed announcements in Needs you, and Also post an announcement.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.61" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });

let updates: typeof import("../../src/app/actions/project/updates");
let orgUpdates: typeof import("../../src/app/actions/org-updates");
let needsYou: typeof import("../../src/lib/organizations/needs-you");
let assignments: typeof import("../../src/app/actions/assignments");
let sprints: typeof import("../../src/lib/projects/server/sprints");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/project/updates"));
  orgUpdates = await loadAppModule(() => import("../../src/app/actions/org-updates"));
  needsYou = await loadAppModule(() => import("../../src/lib/organizations/needs-you"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  sprints = await loadAppModule(() => import("../../src/lib/projects/server/sprints"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(settings: Record<string, unknown> = {}) {
  const [owner, admin, member, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member'), (${id}, ${other!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'company', title = 'Acme Sales', join_code = ${generateJoinCode()}, member_updates_enabled = true,
            org_settings = ${sql.json({ version: 1, ...settings })} WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${member!}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${id}, title = 'North region' WHERE id = ${child}`;
  created.push(id);
  return { id, child, owner: owner!, admin: admin!, member: member!, other: other! };
}

async function post(projectId: string, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  const r = await updates.createProjectUpdateAction(projectId, { content: `Post ${Math.random().toString(36).slice(2, 7)}`, visibility: "members", ...extra } as never);
  assert.equal(r.success, true, JSON.stringify(r));
  return (r as { data?: { id: string } }).data!.id;
}
const titles = async (userId: string) => (await sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${userId}`).map((r) => r.title);

test("an org admin pins a shared post in the org feed only; it counts toward the 3 pins; the child keeps its own pin state", async () => {
  const o = await org();
  const shared = await post(o.child, o.member, { shareToOrg: true, content: "Closed Contoso" });
  viewerId = o.admin;
  const pinned = await updates.toggleProjectUpdatePinAction(o.id, shared, true);
  assert.equal(pinned.success, true, JSON.stringify(pinned));
  assert.equal(pinned.success && pinned.data?.isPinned, true);
  const [childRow] = await sql`SELECT is_pinned FROM project_updates WHERE id = ${shared}`;
  assert.equal(childRow!.is_pinned, false, "the child's own pin is untouched");
  const feed = await updates.readProjectUpdatesAction(o.id, {});
  assert.ok(feed.success && feed.data.updates[0]!.id === shared, "pinned first in the org feed");
  for (const n of [1, 2]) await post(o.id, o.admin, { updateType: "announcement", content: `Pin ${n}`, pin: true });
  viewerId = o.admin;
  const fourth = await post(o.id, o.admin, { updateType: "announcement", content: "One too many" });
  viewerId = o.admin;
  const refused = await updates.toggleProjectUpdatePinAction(o.id, fourth, true);
  assert.equal(refused.success, false, "three pins already, one of them the shared post");
});

test("Notify again tells the audience; removing someone else's post needs a reason the author hears", async () => {
  const o = await org();
  const id = await post(o.id, o.admin, { updateType: "announcement", content: "Pricing from Nov 1" });
  viewerId = o.admin;
  assert.ok((await updates.editProjectUpdateAction(o.id, id, { content: "Pricing from Nov 3", notifyAgain: true })).success);
  assert.ok((await titles(o.member)).includes("Updated: Pricing from Nov 3"), JSON.stringify(await titles(o.member)));

  const discussion = await post(o.id, o.member, { updateType: "discussion", content: "Off-topic post" });
  viewerId = o.admin;
  const blocked = await updates.deleteProjectUpdateAction(o.id, discussion);
  assert.equal(blocked.success, false);
  assert.ok(!blocked.success && blocked.error.startsWith("Say why"));
  assert.ok((await updates.deleteProjectUpdateAction(o.id, discussion, "Off topic for this feed")).success);
  assert.ok((await titles(o.member)).includes("Your post was removed: Off topic for this feed"));
});

test("org defaults: replies from org members, email notify; the audience count; emailed announcements wait in Needs you", async () => {
  const o = await org({ announcementNotify: "email" });
  const id = await post(o.id, o.admin, { updateType: "announcement", content: "All hands Friday" });
  const [row] = await sql`SELECT reply_policy, notify_level FROM project_updates WHERE id = ${id}`;
  assert.deepEqual([row!.reply_policy, row!.notify_level], ["members", "email"]);
  viewerId = o.admin;
  assert.equal(await orgUpdates.countAnnouncementAudienceAction(o.id, {}), 4);
  assert.equal(await orgUpdates.countAnnouncementAudienceAction(o.id, { projectIds: [o.child] }), 3, "the child's people plus the owner and admins");
  viewerId = o.member;
  assert.equal(await orgUpdates.countAnnouncementAudienceAction(o.id, {}), null, "admins only");
  const viewer = { userId: o.other, isAdmin: false, isInside: true, isGuest: false, access: { memberRole: "member" }, org: { id: o.id, title: "Acme Sales", slug: null, status: "active" } } as never;
  assert.ok((await needsYou.readNeedsYou(viewer, new Date())).some((r) => r.label === "Read: All hands Friday"));
  await sql`UPDATE project_members SET last_seen_updates_at = now() WHERE project_id = ${o.id} AND user_id = ${o.other}`;
  assert.ok(!(await needsYou.readNeedsYou(viewer, new Date())).some((r) => r.kind === "announcement"), "gone once opened");
});

test("Also post an announcement on assignment publish and on Start now", async () => {
  const o = await org();
  viewerId = o.owner;
  const published = await assignments.createAssignmentAction({ projectId: o.id, title: "Weekly pipeline report", dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString(), publish: true,
    submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [], announcement: "Weekly pipeline report is out, due Friday." } as never);
  assert.ok(published.success, JSON.stringify(published));
  const [s] = await sql`INSERT INTO project_sprints (project_id, sprint_number, name, status, start_date, end_date) VALUES (${o.id}, 1, 'October push', 'planning', now(), now() + interval '20 days') RETURNING id`;
  const started = await sprints.startSprintNowAction(s!.id, o.id, "October push has started.");
  viewerId = "";
  assert.equal(started.success, true, JSON.stringify(started));
  const posts = await sql`SELECT content FROM project_updates WHERE project_id = ${o.id} AND update_type = 'announcement' ORDER BY created_at`;
  assert.deepEqual(posts.map((p) => p.content), ["Weekly pipeline report is out, due Friday.", "October push has started."]);
  assert.ok((await titles(o.member)).some((t) => t.endsWith("October push has started.")));
});
