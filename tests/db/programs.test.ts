import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.1a (report 31.2 C1): programs — Save as program, Start a cohort (the duplicate with a program link, seats and join method), Retire.
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

let prog: typeof import("../../src/app/actions/programs");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  prog = await loadAppModule(() => import("../../src/app/actions/programs"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("a school admin saves a cohort as a program, a cohort starts from it with its seats and join method, and Retire stops new cohorts", async () => {
  const [principal, teacher] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, principal!, { visibility: "private" }));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${teacher!}, 'member')`;
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, institution_id = ${school}, title = 'Full-stack Web · Cohort 1', term_start = '2027-01-04', term_end = '2027-03-28' WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner')`;
  viewerId = teacher!;
  assert.equal((await prog.saveAsProgramAction(klass, "Full-stack Web")).success, false, "a teacher asks a school admin");
  viewerId = principal!;
  const saved = await prog.saveAsProgramAction(klass, "Full-stack Web");
  assert.ok(saved.success);
  const list = await prog.readProgramsAction(school);
  assert.ok(list.success);
  assert.deepEqual(list.programs.map((p) => [p.name, p.weeks, p.status, p.sourceClass]), [["Full-stack Web", 12, "active", "Full-stack Web · Cohort 1"]]);
  const life = await loadAppModule(() => import("../../src/lib/organizations/lifecycle"));
  const copy = { about: true, docs: true, files: false, sprints: true, assignments: true, channels: false, admins: false };
  const newId = await life.duplicateOrg(klass, principal!, { title: "Full-stack Web · Cohort 2", handle: `fsw-c2-${Date.now().toString(36)}`, termStart: "2027-04-19", copy, cohort: { programId: saved.id, seats: 30, joinMode: "approval" } });
  assert.ok(newId);
  created.push(newId as string);
  const [c2] = await sql`SELECT institution_id, term_start::text, term_end::text, max_collaborators, org_settings->>'programId' AS program, org_settings->>'joinMode' AS join FROM workspaces WHERE id = ${newId as string}`;
  assert.deepEqual([c2!.institution_id, c2!.term_start, c2!.term_end, c2!.max_collaborators, c2!.program, c2!.join], [school, "2027-04-19", "2027-07-11", "30", saved.id, "approval"]);
  const again = await prog.readProgramsAction(school);
  assert.ok(again.success && again.programs[0]!.cohorts === 1 && again.programs[0]!.list[0]!.state !== undefined);
  assert.equal((await prog.updateProgramAction(saved.id, { status: "retired" })).success, true);
  assert.match((await prog.startCohortAction(saved.id, { name: "Cohort 3", handle: "cohort-3-x", start: "2027-08-02", seats: null, joinMode: "instant", copy }) as { error?: string }).error ?? "", /retired/);
  viewerId = teacher!;
  assert.equal((await prog.readProgramsAction(school)).success, false, "programs are the school admins'");
});
