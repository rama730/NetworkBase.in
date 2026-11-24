import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.1d (report 31.2 calls 1–2): a Coaching or bootcamp school starts the classes that join it with Instructor ·
// Mentor · Learner, Modules and approval joining; a class's own values win, and classes already there keep theirs.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.185" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let inst: typeof import("../../src/app/actions/institutions");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function organization(owner: string, settings: Record<string, unknown> = {}) {
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, org_settings = ${sql.json(settings as never)} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  return id;
}
const settingsOf = async (id: string) => (await sql`SELECT org_settings FROM workspaces WHERE id = ${id}`)[0]!.org_settings as Record<string, unknown>;

test("Coaching or bootcamp: new classes start with its words and approval; a class's own values and classes already there are kept", async () => {
  const [principal, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const school = await organization(principal!);
  const before = await organization(principal!);
  viewerId = principal!;
  await inst.makeInstitutionAction(school);
  assert.deepEqual(await inst.joinInstitutionAction(before, school), { success: true, outcome: "joined" });

  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${member!}, 'member')`;
  viewerId = member!;
  assert.equal((await inst.saveSchoolKindAction(school, "coaching")).success, false, "admins only");
  viewerId = principal!;
  assert.equal((await inst.saveSchoolKindAction(school, "camp" as never)).success, false);
  assert.equal((await inst.saveSchoolKindAction(school, "coaching")).success, true);
  const read = await inst.readInstitutionClassesAction(school);
  assert.ok(read.success && read.schoolKind === "coaching");
  assert.equal((await settingsOf(before)).roleNames, undefined, "classes already there keep their words");

  const fresh = await organization(principal!);
  const own = await organization(principal!, { roleNames: { member: "Trainee" }, joinMode: "instant" });
  await inst.joinInstitutionAction(fresh, school);
  await inst.joinInstitutionAction(own, school);
  const f = await settingsOf(fresh);
  assert.deepEqual([f.roleNames, f.mainSprintWord, f.joinMode], [{ owner: "Instructor", admin: "Mentor", member: "Learner" }, "Module", "approval"]);
  const o = await settingsOf(own);
  assert.deepEqual([o.roleNames, o.mainSprintWord, o.joinMode], [{ member: "Trainee" }, "Module", "instant"], "the class's own values win");
});
