import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.19" }) });

let discover: typeof import("../../src/lib/data/discover");
let collab: typeof import("../../src/lib/profile/collaboration");
let orgProfile: typeof import("../../src/app/actions/org-profile");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  discover = await loadAppModule(() => import("../../src/lib/data/discover"));
  collab = await loadAppModule(() => import("../../src/lib/profile/collaboration"));
  orgProfile = await loadAppModule(() => import("../../src/app/actions/org-profile"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(options: { ageDays?: number; members?: number } = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  const owner = await sql.begin((tx) => createUser(tx));
  const [admin, member] = [await sql.begin((tx) => createUser(tx)), await sql.begin((tx) => createUser(tx))];
  const orgId = await sql.begin((tx) => createProject(tx, owner));
  const extra = await Promise.all(Array.from({ length: Math.max(0, (options.members ?? 3) - 3) }, () => sql.begin((tx) => createUser(tx))));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${orgId}, ${owner}, 'owner'), (${orgId}, ${admin}, 'admin')`;
  if ((options.members ?? 3) >= 3) await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${orgId}, ${member}, 'member')`;
  for (const u of extra) await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${orgId}, ${u}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = ${`CSE ${tag}`}, slug = ${`cse-${tag}`},
    created_at = now() - (${options.ageDays ?? 30} || ' days')::interval WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, member));
  const orgOnly = await sql.begin((tx) => createProject(tx, member, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${member}, 'owner'), (${orgOnly}, ${member}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = ${`Compiler Lab ${tag}`} WHERE id = ${child}`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = ${`Secret Lab ${tag}`} WHERE id = ${orgOnly}`;
  created.push(orgId, child, orgOnly);
  return { orgId, child, orgOnly, owner, admin, member, tag };
}

async function contribution(profileId: string, projectId: string, verifiedBy: string | null = profileId) {
  await sql`INSERT INTO profile_project_contributions (profile_id, project_id, source, role_kind, role_title, visibility, started_at, verified_at, verified_by)
    VALUES (${profileId}, ${projectId}, 'membership', 'member', 'Member', 'public', now(), now(), ${verifiedBy})`;
}

const feed = async (filters: Record<string, unknown>) =>
  (await discover.getDiscoverProjects({ status: "all", type: "all", tech: [], sort: "newest", ...filters } as never, undefined, 60, { view: "all", viewerId: null })).projects;

test("Discover: orgs are org cards with their projects count; children carry the org line; new orgs wait", async () => {
  const o = await org();
  const fresh = await org({ ageDays: 1 });
  const all = await feed({ search: o.tag });
  const orgCard = all.find((p) => p.id === o.orgId)!;
  assert.deepEqual([orgCard.kind, orgCard.childProjectCount], ["organization", 2]);
  const childCard = all.find((p) => p.id === o.child)!;
  assert.deepEqual(childCard.cardOrg, { title: `CSE ${o.tag}`, slug: `cse-${o.tag}` });
  assert.ok(!all.some((p) => p.id === o.orgOnly), "Organization projects never reach Discover");
  assert.ok(!(await feed({ search: fresh.tag })).some((p) => p.id === fresh.orgId), "a 1-day-old org waits (decision 160)");
});

test("Discover: Show filter, ?org= filter and @handle search", async () => {
  const o = await org();
  assert.deepEqual((await feed({ search: o.tag, show: "organizations" })).map((p) => p.id), [o.orgId]);
  assert.deepEqual((await feed({ search: o.tag, show: "projects" })).map((p) => p.id), [o.child]);
  assert.deepEqual((await feed({ org: `cse-${o.tag}` })).map((p) => p.id).sort(), [o.orgId, o.child].sort());
  assert.ok((await feed({ search: `cse-${o.tag}` })).some((p) => p.id === o.orgId), "found by @handle");
});

test("profile: org entries verified by org admins, child entries nested data, org-only children without a link", async () => {
  const o = await org();
  await contribution(o.member, o.orgId);
  await contribution(o.member, o.child);
  await contribution(o.member, o.orgOnly);
  viewerId = o.member;
  assert.equal((await orgProfile.verifyOrgContributionsAction(o.orgId, [o.member])).success, false, "members can't verify");
  viewerId = o.admin;
  assert.deepEqual(await orgProfile.verifyOrgContributionsAction(o.orgId, [o.member]), { success: true, verified: 1 });

  const pub = (await collab.getProfileContributions(o.member)).contributions;
  const orgEntry = pub.find((c) => c.projectId === o.orgId)!;
  assert.deepEqual([orgEntry.projectKind, orgEntry.orgVerified], ["organization", true]);
  const childEntry = pub.find((c) => c.projectId === o.child)!;
  assert.equal(childEntry.parentOrg?.id, o.orgId);
  const secret = pub.find((c) => c.projectId === o.orgOnly)!;
  assert.deepEqual([secret.projectHref, secret.orgOnly], [null, true], "Visible to the org's members, no link");

  assert.equal((await orgProfile.revokeOrgVerificationAction(o.orgId, o.member, "Left before the term ended")).success, true);
  const after = (await collab.getProfileContributions(o.member, { includePrivate: true })).contributions.find((c) => c.projectId === o.orgId)!;
  assert.deepEqual([after.orgVerified, after.verificationRevokedReason], [false, "Left before the term ended"]);
});

test("profile: Show on my profile off hides the org entry, its project entries and its card from others", async () => {
  const o = await org();
  await contribution(o.member, o.orgId);
  await contribution(o.member, o.child);
  await sql`UPDATE project_members SET show_on_profile = false WHERE project_id = ${o.orgId} AND user_id = ${o.member}`;
  const pub = (await collab.getProfileContributions(o.member)).contributions.map((c) => c.projectId);
  assert.ok(!pub.includes(o.orgId) && !pub.includes(o.child), JSON.stringify(pub));
  const own = (await collab.getProfileContributions(o.member, { includePrivate: true })).contributions.map((c) => c.projectId);
  assert.ok(own.includes(o.orgId), "the owner still sees it");
  const portfolio = (await collab.getProfilePortfolioProjects(o.member)).projects.map((p) => p.id);
  assert.ok(!portfolio.includes(o.orgId) && !portfolio.includes(o.child));
  await sql`UPDATE project_members SET show_on_profile = true WHERE project_id = ${o.orgId} AND user_id = ${o.member}`;
  const shown = (await collab.getProfilePortfolioProjects(o.member)).projects;
  assert.equal(shown.find((p) => p.id === o.orgId)?.kind, "organization");
  assert.equal(shown.find((p) => p.id === o.child)?.cardOrg?.title, `CSE ${o.tag}`);
});

test("§24 pass: guests get no automatic entry; story helpers; opt-in Work record; detached and deleted-org labels; Following adds an org's public projects", async () => {
  const o = await org();
  const lifecycle = await loadAppModule(() => import("../../src/lib/projects/collaborator-lifecycle"));
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  const guest = await sql.begin((tx) => createUser(tx));
  await lifecycle.addProjectMemberInternal(db as never, { projectId: o.orgId, userId: guest, role: "viewer", actorId: o.owner, source: "email_invite" } as never);
  assert.equal((await sql`SELECT count(*)::int AS n FROM profile_project_contributions WHERE profile_id = ${guest} AND project_id = ${o.orgId}`)[0]!.n, 0);

  await sql`UPDATE projects SET description = 'Data Structures, Section A.' WHERE id = ${o.orgId}`;
  await contribution(o.member, o.orgId);
  const [entry] = await sql`SELECT id FROM profile_project_contributions WHERE profile_id = ${o.member} AND project_id = ${o.orgId}`;
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id) VALUES (${o.orgId}, 'Lab 1', 'assignment', ${o.owner}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, status) VALUES (${o.orgId}, 'Lab 1', 'task', ${m!.id}, ${o.member}, ${o.owner}, 'done')`;
  viewerId = o.member;
  assert.deepEqual(await orgProfile.readOrgStoryStarterAction(entry!.id, "about"), { success: true, text: "Data Structures, Section A." });
  const work = await orgProfile.readOrgStoryStarterAction(entry!.id, "work");
  assert.ok(work.success && work.text.includes("- Lab 1") && work.text.includes(`- Compiler Lab ${o.tag}`), JSON.stringify(work));
  viewerId = o.admin;
  assert.equal((await orgProfile.readOrgStoryStarterAction(entry!.id, "about")).success, false, "only your own entry");

  viewerId = o.member;
  assert.ok((await orgProfile.setWorkRecordAction(entry!.id, true)).success);
  const shown = (await collab.getProfileContributions(o.member)).contributions.find((c) => c.projectId === o.orgId)!;
  assert.deepEqual(shown.workRecord, { done: 1, total: 1, sprints: 0 });

  // Following the org lists its public child project.
  await sql`INSERT INTO project_follows (project_id, user_id) VALUES (${o.orgId}, ${o.admin})`;
  const following = (await discover.getDiscoverProjects({ status: "all", type: "all", tech: [], sort: "newest" } as never, undefined, 60, { view: "following", viewerId: o.admin })).projects.map((p) => p.id);
  assert.ok(following.includes(o.child) && !following.includes(o.orgOnly), JSON.stringify(following));

  // Detached child: "with <org> (until …)"; deleted org: name kept, no link.
  await contribution(o.member, o.child);
  const children = await loadAppModule(() => import("../../src/lib/organizations/children"));
  await children.detachFromOrg(o.child);
  const detached = (await collab.getProfileContributions(o.member, { includePrivate: true })).contributions.find((c) => c.projectId === o.child)!;
  assert.equal(detached.formerOrg?.title, `CSE ${o.tag}`);
  await sql`UPDATE projects SET deleted_at = now() WHERE id = ${o.orgId}`;
  const gone = (await collab.getProfileContributions(o.member, { includePrivate: true })).contributions.find((c) => c.projectId === o.orgId)!;
  assert.deepEqual([gone.goneOrgTitle, gone.projectHref], [`CSE ${o.tag}`, null]);
});
