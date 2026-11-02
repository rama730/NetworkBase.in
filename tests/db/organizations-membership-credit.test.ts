import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { blankContributionStory } from "../../src/lib/profile/contribution-story";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 2 (report §4, §10.1, §38.5): how a membership ends, and who sees the entry afterwards.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.18" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
stubNextAfter();

let members: typeof import("../../src/app/actions/org-members");
let orgs: typeof import("../../src/app/actions/organizations");
let collaboration: typeof import("../../src/lib/profile/collaboration");
let appDb: typeof import("../../src/lib/db");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  collaboration = await loadAppModule(() => import("../../src/lib/profile/collaboration"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(visibility: "public" | "private" = "public") {
  const [owner, a, b] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${b!}, 'member')`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, title) VALUES (${id}, ${a!}, 'member', 'Course Instructor')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE 3B', visibility = ${visibility} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, a: a!, b: b! };
}

/** The person's entry, made the way joining makes it, then published with their own words. */
async function publishedEntry(profileId: string, projectId: string, verifiedBy: string, words = "Ran the weekly labs.") {
  await appDb.db.transaction((tx) => collaboration.upsertProfileWorkspaceContributionFromMembership(tx, { profileId, projectId, verifiedBy }));
  const story = { ...blankContributionStory("CSE 3B"), summary: words, visible: true };
  const [row] = await sql`UPDATE profile_contributions SET presentation = ${sql.json(story as never)}, published_at = now(), visibility = 'public'
    WHERE profile_id = ${profileId} AND workspace_id = ${projectId} RETURNING id`;
  return row!.id as string;
}

const publicIds = async (profileId: string) => (await collaboration.getProfileContributions(profileId, { includePrivate: false })).contributions.map((c) => c.id);
const ownIds = async (profileId: string) => (await collaboration.getProfileContributions(profileId, { includePrivate: true })).contributions.map((c) => c.id);

test("4.3, decision 1: removal records who and why, withdraws verification, and hides the entry and nested work from others", async () => {
  const o = await org();
  const child = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon', visibility = 'public' WHERE id = ${child}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${o.owner}, 'owner'), (${child}, ${o.a}, 'member')`;
  const entry = await publishedEntry(o.a, o.id, o.owner);
  const nested = await publishedEntry(o.a, child, o.owner, "Built the hash table.");
  assert.ok((await publicIds(o.a)).includes(entry));

  viewerId = o.owner;
  assert.equal((await members.removeMembersAction(o.id, [o.a], { block: false, reason: "Repeated no-shows" })).success, true);
  const [row] = await sql`SELECT end_reason, ended_by, end_note, verified_at, verification_revoked_reason, ended_at FROM profile_contributions WHERE id = ${entry}`;
  assert.deepEqual([row!.end_reason, row!.ended_by, row!.end_note, row!.verified_at, row!.verification_revoked_reason], ["removed", o.owner, "Repeated no-shows", null, "Removed from CSE 3B"]);
  assert.ok(row!.ended_at);
  const [nestedRow] = await sql`SELECT end_reason FROM profile_contributions WHERE id = ${nested}`;
  assert.equal(nestedRow!.end_reason, "removed", "nested workspace entries follow the same rule");
  const others = await publicIds(o.a);
  assert.ok(!others.includes(entry) && !others.includes(nested), "others see nothing");
  const own = await ownIds(o.a);
  assert.ok(own.includes(entry) && own.includes(nested), "the person still has their own words");
});

test("4.3, decision 2: leaving keeps credit; the entry stays public as Left", async () => {
  const o = await org();
  const entry = await publishedEntry(o.a, o.id, o.owner);
  viewerId = o.a;
  assert.equal((await orgs.leaveOrgAction(o.id)).success, true);
  const [row] = await sql`SELECT end_reason, ended_by, verified_at FROM profile_contributions WHERE id = ${entry}`;
  assert.deepEqual([row!.end_reason, row!.ended_by], ["left", o.a]);
  assert.ok(row!.verified_at, "leaving keeps verification");
  assert.ok((await publicIds(o.a)).includes(entry));
});

test("decision 3: a removed person who rejoins gets their words back as an unpublished draft", async () => {
  const o = await org();
  const entry = await publishedEntry(o.a, o.id, o.owner);
  viewerId = o.owner;
  await members.removeMembersAction(o.id, [o.a], { block: false });
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${o.a}, 'member')`;
  await appDb.db.transaction((tx) => collaboration.upsertProfileWorkspaceContributionFromMembership(tx, { profileId: o.a, projectId: o.id, verifiedBy: null }));
  const [row] = await sql`SELECT end_reason, ended_by, ended_at, presentation, published_at FROM profile_contributions WHERE id = ${entry}`;
  assert.deepEqual([row!.end_reason, row!.ended_by, row!.ended_at, row!.presentation, row!.published_at], [null, null, null, null, null]);
  const [draft] = await sql`SELECT document FROM profile_contribution_drafts WHERE contribution_id = ${entry}`;
  assert.equal(draft!.document.summary, "Ran the weekly labs.");
});

test("decision 105: a private organization's entry shows to its members and nobody else", async () => {
  const o = await org("private");
  const entry = await publishedEntry(o.a, o.id, o.owner);
  const stranger = await sql.begin((tx) => createUser(tx));
  assert.ok(!(await publicIds(o.a)).includes(entry), "not in the public profile");
  assert.deepEqual((await collaboration.readSharedPrivateOrgContributions(o.a, o.b)).map((c) => c.id), [entry], "a fellow member sees it");
  assert.deepEqual(await collaboration.readSharedPrivateOrgContributions(o.a, stranger), []);
});

test("4.4: an organization entry shows the organization's role name and the title, never Contributor", async () => {
  const o = await org();
  const entry = await publishedEntry(o.a, o.id, o.owner);
  const mine = (await collaboration.getProfileContributions(o.a, { includePrivate: true })).contributions.find((c) => c.id === entry)!;
  assert.equal(mine.title, "Student · Course Instructor");
  const owner = await publishedEntry(o.owner, o.id, o.owner);
  const theirs = (await collaboration.getProfileContributions(o.owner, { includePrivate: true })).contributions.find((c) => c.id === owner)!;
  assert.equal(theirs.title, "Teacher");
});

test("26.9, decision 48: the private page knows each person's state", async () => {
  const o = await org("private");
  const join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  const [stranger, asker, blocked] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  assert.deepEqual(await join.readPrivateOrgState(o.id, null), { kind: "none" });
  assert.deepEqual(await join.readPrivateOrgState(o.id, stranger!), { kind: "none" });
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.id}, ${asker!}, ${o.owner}, 'pending')`;
  assert.deepEqual(await join.readPrivateOrgState(o.id, asker!), { kind: "waiting" });
  await sql`INSERT INTO org_join_blocks (org_id, user_id, blocked_by) VALUES (${o.id}, ${blocked!}, ${o.owner})`;
  assert.deepEqual(await join.readPrivateOrgState(o.id, blocked!), { kind: "blocked" });
  await publishedEntry(o.a, o.id, o.owner);
  viewerId = o.owner;
  await members.removeMembersAction(o.id, [o.a], { block: false });
  assert.deepEqual(await join.readPrivateOrgState(o.id, o.a), { kind: "removed" });
  await publishedEntry(o.b, o.id, o.owner);
  viewerId = o.b;
  await orgs.leaveOrgAction(o.id);
  assert.equal((await join.readPrivateOrgState(o.id, o.b)).kind, "left");
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.id}`;
  assert.deepEqual(await join.readPrivateOrgState(o.id, stranger!), { kind: "ended" });
});

test("26.10: the leave dialog says what happens, in the organization's words", async () => {
  const o = await org();
  const team = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${team}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${o.owner}, 'owner'), (${team}, ${o.a}, 'member')`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, '{"publishedAt":"2026-11-01T00:00:00Z"}'::jsonb) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id) VALUES (${o.id}, 'Lab 1', ${o.owner}, ${o.a}, ${master!.id})`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id, submission, review_status) VALUES (${o.id}, 'Lab 0', ${o.owner}, ${o.a}, ${master!.id}, '{"version":1}'::jsonb, 'pending')`;
  viewerId = o.a;
  const result = await orgs.readLeavePreviewAction(o.id);
  assert.deepEqual(result.success && result.preview, { teams: ["Team Falcon"], led: [], open: 1, submitted: 1, keptBy: "Teachers and TAs" });
});
