import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B3.1a (report 32.2 calls 1–2): a school sets its year; every class follows it — its term is the year's span and
// holidays and staff days reach it as breaks, so no sessions fall on them; half days keep classes; leaving clears it.
let viewerId = "";
let token: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.194" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/school-year");
let inst: typeof import("../../src/app/actions/institutions");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/school-year"));
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const year = { name: "2026–27", terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-12-18" }],
  days: [{ name: "Half-term", kind: "holiday", start: "2026-10-26", end: "2026-10-30" }, { name: "Sports day", kind: "half", start: "2026-10-14", end: "2026-10-14" }] };

test("a school's year reaches its classes: term span, holidays as breaks, half days kept; leaving clears it", async () => {
  const [principal, teacher] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = async (owner: string) => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const school = await org(principal!);
  const klass = await org(principal!);
  viewerId = principal!;
  await inst.makeInstitutionAction(school);
  await inst.joinInstitutionAction(klass, school);
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || ${sql.json({ classDetails: { meets: [{ day: 3, start: "10:30", end: "11:30" }], breaks: [], show: {} } } as never)} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${teacher!}, 'member')`;

  viewerId = teacher!;
  assert.equal((await act.saveSchoolYearAction(school, year)).success, false, "school admins set the year");
  viewerId = principal!;
  token = "agent";
  assert.equal((await act.saveSchoolYearAction(school, year)).success, false, "never a token");
  token = null;
  assert.match((await act.saveSchoolYearAction(school, { ...year, terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-09-01" }] }) as { error?: string }).error ?? "", /ends before it starts/);
  assert.equal((await act.saveSchoolYearAction(klass, year)).success, false, "a class isn't a school");
  const saved = await act.saveSchoolYearAction(school, year);
  assert.ok(saved.success && saved.classes >= 1);

  const [c] = await sql`SELECT term_start::text AS s, term_end::text AS e, org_settings->'schoolBreaks' AS breaks FROM workspaces WHERE id = ${klass}`;
  assert.deepEqual([c!.s, c!.e, (c!.breaks as Array<{ name: string }>).map((b) => b.name)], ["2026-09-02", "2026-12-18", ["Half-term"]]);
  const { readClassDetails, termSessions } = await loadAppModule(() => import("../../src/lib/organizations/class-sessions"));
  const [settings] = await sql`SELECT org_settings FROM workspaces WHERE id = ${klass}`;
  const sessions = termSessions(readClassDetails(settings!.org_settings)!, { start: "2026-09-02", end: "2026-12-18" });
  assert.ok(!sessions.some((s) => s.start.startsWith("2026-10-28")), "no class on the half-term Wednesday");
  assert.ok(sessions.some((s) => s.start.startsWith("2026-10-14")), "the half day keeps its class");

  const read = await act.readSchoolYearAction(klass);
  assert.ok(read.success && !read.isSchool && !read.canEdit && read.year?.name === "2026–27");

  assert.equal((await inst.unlinkClassAction(klass)).success, true);
  const [left] = await sql`SELECT org_settings ? 'schoolYear' AS y, org_settings ? 'schoolBreaks' AS b FROM workspaces WHERE id = ${klass}`;
  assert.deepEqual([left!.y, left!.b], [false, false], "a class that leaves keeps none of the school's year");
});
