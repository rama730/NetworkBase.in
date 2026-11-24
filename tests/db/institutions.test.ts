import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B0.1 (report 29.2, with its correction): an Education organization becomes an institution; classes join it
// by institution_id (at once for its admins, by request otherwise), leave or are removed; the institution sees counts
// and states only and never gains read of a class or its students' work.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.182" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let inst: typeof import("../../src/app/actions/institutions");
let access: typeof import("../../src/lib/data/workspace-access");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function organization(owner: string, type = "education") {
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, join_code = ${generateJoinCode()} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  return id;
}
async function setup() {
  const [principal, teacher, student, otherTeacher] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const school = await organization(principal!);
  const klass = await organization(teacher!);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${student!}, 'member'), (${school}, ${teacher!}, 'member'), (${school}, ${otherTeacher!}, 'member')`;
  const team = await sql.begin((tx) => createProject(tx, student!, { visibility: "org" }));
  created.push(team);
  await sql`UPDATE workspaces SET parent_id = ${klass} WHERE id = ${team}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${student!}, 'owner')`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind) VALUES (${klass}, 'Essay 1', 'todo', 'medium', ${teacher!}, 'assignment') RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, review_status) VALUES (${team}, 'Essay 1', 'todo', 'medium', ${student!}, 'task', ${master!.id}, 'pending')`;
  return { principal: principal!, teacher: teacher!, student: student!, otherTeacher: otherTeacher!, school, klass, team };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("an Education organization without workspaces becomes an institution; only its owner; classes join by request", async () => {
  const t = await setup();
  viewerId = t.teacher;
  assert.equal((await inst.makeInstitutionAction(t.school)).success, false, "only the owner");
  viewerId = t.principal;
  assert.equal((await inst.makeInstitutionAction(t.school)).success, true);
  viewerId = t.teacher;
  assert.match(errorOf(await inst.makeInstitutionAction(t.klass)), /has workspaces already/);
  const asked = await inst.joinInstitutionAction(t.klass, t.school);
  assert.deepEqual(asked, { success: true, outcome: "requested" });
  viewerId = t.principal;
  const list = await inst.readInstitutionClassesAction(t.school);
  assert.deepEqual(list.success && list.requests.map((r) => r.id), [t.klass]);
  assert.equal((await inst.decideClassRequestAction(t.school, t.klass, true)).success, true);
  const [row] = await sql`SELECT institution_id, parent_id, org_settings ? 'institutionRequest' AS pending FROM workspaces WHERE id = ${t.klass}`;
  assert.deepEqual([row!.institution_id, row!.parent_id, row!.pending], [t.school, null, false]);
});

test("privacy call: the institution sees counts and states only, never read of the class or its students' work", async () => {
  const t = await setup();
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  viewerId = t.teacher;
  await inst.joinInstitutionAction(t.klass, t.school);
  viewerId = t.principal;
  await inst.decideClassRequestAction(t.school, t.klass, true);
  const list = await inst.readInstitutionClassesAction(t.school);
  assert.ok(list.success && list.isAdmin);
  assert.deepEqual(list.classes.map((c) => [c.id, c.members, c.openAssignments, c.toReview]), [[t.klass, 2, 1, 1]]);
  assert.deepEqual(Object.keys(list.classes[0]!).sort(), ["behindPlan", "counted", "department", "id", "lastActivity", "members", "openAssignments", "slug", "teacher", "termEnd", "termStart", "title", "toReview"]);
  const classAccess = await access.getWorkspaceAccessById(t.klass, t.principal);
  const teamAccess = await access.getWorkspaceAccessById(t.team, t.principal);
  assert.deepEqual([classAccess.canRead, classAccess.isInheritedAdmin, teamAccess.canRead, teamAccess.isInheritedAdmin], [false, false, false, false]);
  viewerId = t.otherTeacher;
  const asMember = await inst.readInstitutionClassesAction(t.school);
  assert.deepEqual(asMember.success && asMember.classes.map((c) => [c.title, c.members, c.toReview]), [["" + (await sql`SELECT title FROM workspaces WHERE id = ${t.klass}`)[0]!.title, 0, 0]], "members see titles only");
  viewerId = t.student;
  assert.equal((await inst.readInstitutionClassesAction(t.school)).success, false, "outsiders of the school see nothing");
});

test("admins join at once; a class leaves or is removed; a linked class can't join another; non-Education refused", async () => {
  const t = await setup();
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  const own = await organization(t.principal);
  assert.deepEqual(await inst.joinInstitutionAction(own, t.school), { success: true, outcome: "joined" });
  const club = await organization(t.principal, "club");
  assert.match(errorOf(await inst.joinInstitutionAction(club, t.school)), /Only an Education class/);
  const other = await organization(t.principal);
  await inst.makeInstitutionAction(other);
  assert.match(errorOf(await inst.joinInstitutionAction(own, other)), /already part of a school/);
  viewerId = t.teacher;
  assert.equal((await inst.unlinkClassAction(own)).success, false, "not theirs to remove");
  viewerId = t.principal;
  assert.equal((await inst.unlinkClassAction(own)).success, true, "the institution removes it");
  assert.equal((await sql`SELECT institution_id FROM workspaces WHERE id = ${own}`)[0]!.institution_id, null);
  await assert.rejects(sql`UPDATE workspaces SET institution_id = ${own} WHERE id = ${own}`, /institution_link_check/);
});

test("security review: a decided request can't be decided again; a suspended school can't decide or take classes", async () => {
  const t = await setup();
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  viewerId = t.teacher;
  await inst.joinInstitutionAction(t.klass, t.school);
  viewerId = t.principal;
  assert.equal((await inst.decideClassRequestAction(t.school, t.klass, false)).success, true);
  assert.equal((await inst.decideClassRequestAction(t.school, t.klass, true)).success, false, "already declined");
  assert.equal((await sql`SELECT institution_id FROM workspaces WHERE id = ${t.klass}`)[0]!.institution_id, null);
  viewerId = t.teacher;
  await inst.joinInstitutionAction(t.klass, t.school);
  await sql`UPDATE workspaces SET suspended_at = now() WHERE id = ${t.school}`;
  viewerId = t.principal;
  assert.equal((await inst.decideClassRequestAction(t.school, t.klass, true)).success, false, "suspended: read-only");
  const own = await organization(t.principal);
  assert.equal((await inst.joinInstitutionAction(own, t.school)).success, false);
  viewerId = t.teacher;
  const mine = await inst.readClassInstitutionAction(t.klass);
  assert.deepEqual(mine.success && mine.schools.map((s) => s.id), [], "a suspended school isn't offered");
});

test("B0.2: departments and heads — a head sees counts for their department only; members titles; heads must be members", async () => {
  const t = await setup();
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  const science = await organization(t.otherTeacher);
  const arts = await organization(t.otherTeacher);
  await sql`UPDATE workspaces SET institution_id = ${t.school} WHERE id IN (${science}, ${arts})`;
  assert.match(errorOf(await inst.saveDepartmentsAction(t.school, [{ name: "Science" }, { name: "science" }])), /same name/);
  const saved = await inst.saveDepartmentsAction(t.school, [{ name: "Science", heads: [t.teacher, t.student] }, { name: "Arts" }]);
  assert.ok(saved.success);
  assert.deepEqual(saved.departments.map((d) => [d.name, d.heads]), [["Science", [t.teacher]], ["Arts", []]], "the student isn't in the school, so isn't a head");
  const [sci, art] = saved.departments;
  assert.equal((await inst.setClassDepartmentAction(t.school, science, sci!.id)).success, true);
  assert.equal((await inst.setClassDepartmentAction(t.school, arts, art!.id)).success, true);
  assert.equal((await inst.setClassDepartmentAction(t.school, t.klass, sci!.id)).success, false, "not a class of this school");
  viewerId = t.teacher;
  assert.equal((await inst.saveDepartmentsAction(t.school, [])).success, false, "heads don't edit departments");
  const asHead = await inst.readInstitutionClassesAction(t.school);
  assert.ok(asHead.success && !asHead.isAdmin);
  assert.deepEqual(asHead.headOf, [sci!.id]);
  assert.deepEqual(asHead.classes.map((c) => [c.id, c.counted, c.members]), [[science, true, 1], [arts, false, 0]].sort((a, b) => asHead.classes.findIndex((c) => c.id === a[0]) - asHead.classes.findIndex((c) => c.id === b[0])));
  assert.deepEqual(asHead.departments.map((d) => d.heads), [[], []], "heads' names are for admins");
  viewerId = t.otherTeacher;
  const asMember = await inst.readInstitutionClassesAction(t.school);
  assert.ok(asMember.success && asMember.classes.every((c) => !c.counted && c.members === 0));
});

test("B0.2: the school's settings reach its classes on join and on save, locked there; leaving unlocks", async () => {
  const t = await setup();
  const orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"assignmentLateRule":"none","assignmentAiPolicy":"not_allowed"}'::jsonb,
    term_start = '2027-01-10', term_end = '2027-05-20' WHERE id = ${t.school}`;
  viewerId = t.teacher;
  await inst.joinInstitutionAction(t.klass, t.school);
  viewerId = t.principal;
  await inst.decideClassRequestAction(t.school, t.klass, true);
  const [c1] = await sql`SELECT org_settings->>'assignmentLateRule' AS late, org_settings->>'assignmentAiPolicy' AS ai, term_start::text, term_end::text FROM workspaces WHERE id = ${t.klass}`;
  assert.deepEqual([c1!.late, c1!.ai, c1!.term_start, c1!.term_end], ["none", "not_allowed", "2027-01-10", "2027-05-20"]);
  viewerId = t.teacher;
  assert.match(errorOf(await orgs.updateOrgSettingsAction(t.klass, "work", { late_rule: "always" })), /Your school sets this/);
  assert.equal((await orgs.updateOrgSettingsAction(t.klass, "work", { late_rule: "none", reminders: "off" })).success, true, "today's value with other fields saves");
  viewerId = t.principal;
  assert.equal((await orgs.updateOrgSettingsAction(t.school, "work", { late_rule: "always" })).success, true);
  assert.equal((await sql`SELECT org_settings->>'assignmentLateRule' AS late FROM workspaces WHERE id = ${t.klass}`)[0]!.late, "always", "a school save reaches its classes");
  viewerId = t.teacher;
  await inst.unlinkClassAction(t.klass);
  assert.equal((await orgs.updateOrgSettingsAction(t.klass, "work", { late_rule: "until" })).success, true, "out of the school, the class decides");
});

test("B0.2 security review: a copied class rejoins its school only by the join rule", async () => {
  const t = await setup();
  const push = await loadAppModule(() => import("../../src/lib/organizations/school-push"));
  viewerId = t.principal;
  await inst.makeInstitutionAction(t.school);
  const byMember = await organization(t.teacher);
  assert.equal(await push.joinSchoolAs(byMember, t.school, t.teacher), "requested");
  const [r1] = await sql`SELECT institution_id, org_settings->'institutionRequest'->>'institutionId' AS asked FROM workspaces WHERE id = ${byMember}`;
  assert.deepEqual([r1!.institution_id, r1!.asked], [null, t.school]);
  const byAdmin = await organization(t.principal);
  assert.equal(await push.joinSchoolAs(byAdmin, t.school, t.principal), "joined");
  const byOutsider = await organization(t.student);
  assert.equal(await push.joinSchoolAs(byOutsider, t.school, t.student), null);
  assert.equal((await sql`SELECT institution_id FROM workspaces WHERE id = ${byOutsider}`)[0]!.institution_id, null);
});
