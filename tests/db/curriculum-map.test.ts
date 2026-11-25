import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B3.2b (report 32.3 Year map, call 8): courses × school weeks; Taught per class and Behind the map only for the
// school's leaders and that department's heads; unit names and counts only, never lesson text.
let viewerId = "";
const token: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.197" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let map: typeof import("../../src/app/actions/curriculum-map");
let inst: typeof import("../../src/app/actions/institutions");
let year: typeof import("../../src/app/actions/school-year");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  map = await loadAppModule(() => import("../../src/app/actions/curriculum-map"));
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
  year = await loadAppModule(() => import("../../src/app/actions/school-year"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("Year map: units as spans per course; Taught per class only for leaders and the department's heads; no lesson text", async () => {
  const [principal, head, teacher, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = async (owner: string) => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC' WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const school = await org(principal!);
  viewerId = principal!;
  await inst.makeInstitutionAction(school);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${head!}, 'member'), (${school}, ${teacher!}, 'member')`;
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || ${sql.json({ departments: [{ id: "sci", name: "Science", heads: [head!] }, { id: "eng", name: "English", heads: [] }] })} WHERE id = ${school}`;
  assert.equal((await year.saveSchoolYearAction(school, { name: "Y", terms: [{ name: "Term 1", start: "2026-09-01", end: "2026-12-18" }], days: [{ name: "Half-term", kind: "holiday", start: "2026-10-26", end: "2026-10-30" }] })).success, true);
  const science = await org(teacher!);
  const english = await org(teacher!);
  for (const [c, dept] of [[science, "sci"], [english, "eng"]] as const) {
    await sql`UPDATE workspaces SET institution_id = ${school}, org_settings = coalesce(org_settings, '{}'::jsonb) || ${sql.json({ department: dept, termPlan: { groups: ["6A", "6B"] } })} WHERE id = ${c}`;
  }
  const [unit] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${science}, 1, 'Cells', '2026-09-01', '2026-09-20', 'completed') RETURNING id`;
  const [week] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${science}, 2, 'Week 1', '2026-09-01', '2026-09-06', 'completed', ${unit!.id}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, item_type, stage, sprint_id, type_fields, creator_id)
    VALUES (${science}, 'Secret lesson words', 'done', 'medium', 'class_lesson', 'ready', ${week!.id}, ${sql.json({ lessonType: "assessment", taught: { "6A": { on: "2026-09-02", by: teacher! } } })}, ${teacher!}),
           (${science}, 'Second', 'todo', 'medium', 'class_lesson', 'ready', ${week!.id}, '{}'::jsonb, ${teacher!})`;

  // A self-paced Path lesson (in a path step, not a Term plan week) never counts on the map.
  const [step] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, path_position) VALUES (${english}, 1, 'Step 1', 'active', 0) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, item_type, stage, sprint_id, type_fields, creator_id) VALUES (${english}, 'Path lesson', 'todo', 'medium', 'class_lesson', 'ready', ${step!.id}, '{}'::jsonb, ${teacher!})`;
  const leader = await map.readYearMapAction(school);
  assert.ok(leader.success);
  assert.equal(JSON.stringify(leader).includes("Secret lesson words"), false, "unit names and counts only");
  assert.equal(leader.weeks.find((w) => w.start === "2026-10-26")?.holiday, "Half-term");
  const row = leader.rows.find((r) => r.id === science)!;
  assert.deepEqual(row.segments.filter((s) => s.kind === "unit").map((s) => s.kind === "unit" && [s.name, s.draft, s.assessment, s.span]), [["Cells", false, true, 3]]);
  assert.deepEqual(row.taught.map((t) => [t.group, t.taught, t.due, t.behind]), [["6A", 1, 2, 1], ["6B", 0, 2, 2]]);
  assert.equal(row.taught[1]!.warn, true);
  assert.equal(leader.rows.find((r) => r.id === english)!.planned.total, 0, "found live: Path lessons aren't the plan");

  viewerId = head!;
  const h = await map.readYearMapAction(school);
  assert.ok(h.success);
  assert.equal(h.rows.find((r) => r.id === science)!.taught.length, 2, "the head sees their department");
  assert.deepEqual(h.rows.find((r) => r.id === english)!.taught, [], "not another department");
  viewerId = teacher!;
  const t = await map.readYearMapAction(school);
  assert.ok(t.success);
  assert.ok(t.rows.every((r) => r.taught.length === 0), "teachers see Planned, not pacing");
  assert.equal(t.rows.find((r) => r.id === science)!.planned.percent, 100);
  viewerId = outsider!;
  assert.equal((await map.readYearMapAction(school)).success, false);
  assert.equal((await map.readYearMapAction(science)).success, false, "a class isn't a school");
});
