import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.5b (report 35.6): supervision notes never reach anyone outside the person and their supervisors (server test); a PI
// outside the pair sees only the rhythm; milestones from the template and start date; moved only with a reason.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.251" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let pg: typeof import("../../src/app/actions/lab-progress");
let li: typeof import("../../src/app/actions/lab-library");
let lab: typeof import("../../src/app/actions/lab");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  li = await loadAppModule(() => import("../../src/app/actions/lab-library"));
  pg = await loadAppModule(() => import("../../src/app/actions/lab-progress"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.6 supervision and milestones: notes stay with the pair; PI sees rhythm only; template from the start date", async () => {
  const [pi, rao, mei, ravi, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, view_prefs) VALUES (${org}, ${pi!}, 'owner', '{}'::jsonb), (${org}, ${rao!}, 'admin', '{}'::jsonb),
    (${org}, ${mei!}, 'member', ${sql.json({ lab: { position: "phd", startYear: 2024 } })}), (${org}, ${ravi!}, 'member', ${sql.json({ lab: { position: "masters", startYear: 2025 } })})`;
  // Dr. Rao supervises Mei.
  await sql`UPDATE workspaces SET org_settings = ${sql.json({ staffGrowth: { reportsTo: { [mei!]: rao! } } })} WHERE id = ${org}`;

  viewerId = mei!;
  assert.equal((await pg.setProgressAction(org, mei!, { startDate: "2024-09-01", partTime: false, coSupervisorId: null, weeks: 2 })).success, false, "the PI and Researchers set it up");
  viewerId = rao!;
  assert.match(String((await pg.setProgressAction(org, mei!, { startDate: "2024-09-01", partTime: false, coSupervisorId: ravi!, weeks: 2 }) as { error?: string }).error), /co-supervisor/);
  const set = await pg.setProgressAction(org, mei!, { startDate: "2024-09-01", partTime: false, coSupervisorId: null, weeks: 2 });
  assert.ok(set.success && set.milestones === 8);
  viewerId = pi!;
  assert.ok((await pg.setProgressAction(org, ravi!, { startDate: "2025-09-01", partTime: true, coSupervisorId: rao!, weeks: 4 })).success);

  // Mei writes a supervision note; Rao reads it; Ravi and an outsider can't; the PI (not her supervisor) sees the rhythm only.
  viewerId = mei!;
  assert.match(String((await pg.addSupervisionNoteAction(org, mei!, { metOn: "2099-01-01", topics: "x", notes: "", nextSteps: "" }) as { error?: string }).error), /happened/);
  assert.ok((await pg.addSupervisionNoteAction(org, mei!, { metOn: "2026-11-20", topics: "Chapter 2", notes: "private worries", nextSteps: "Rerun the eval" })).success);
  viewerId = rao!;
  const asSup = await pg.readProgressAction(org, mei!);
  assert.ok(asSup.success && asSup.set && asSup.notes.some((n) => n.notes === "private worries"));
  viewerId = pi!;
  const asPi = await pg.readProgressAction(org, mei!);
  assert.ok(asPi.success && asPi.set && asPi.notes.length === 0 && asPi.rhythm.lastMet === "2026-11-20", "the PI outside the pair sees the rhythm, never the notes");
  assert.equal((await pg.addSupervisionNoteAction(org, mei!, { metOn: "2026-11-21", topics: "x", notes: "", nextSteps: "" })).success, false);
  viewerId = ravi!;
  assert.equal((await pg.readProgressAction(org, mei!)).success, false, "another student sees nothing");
  viewerId = outsider!;
  assert.equal((await pg.readProgressAction(org, mei!)).success, false);
  const [leak] = await sql`SELECT count(*)::int AS n FROM lab_supervision_notes WHERE student_id = ${mei!}`;
  assert.equal(leak!.n, 1);

  // Milestones: part-time doubles; Mei hands in; only her supervisors or the PI decide; a move needs a reason.
  viewerId = rao!;
  const ravisPlan = await pg.readProgressAction(org, ravi!);
  assert.ok(ravisPlan.success && ravisPlan.set && ravisPlan.milestones.find((m) => m.key === "submission")!.dueOn === "2029-05-01", "part-time doubles the months");
  viewerId = mei!;
  assert.ok((await pg.handInMilestoneAction(org, "proposal")).success);
  assert.equal((await pg.decideMilestoneAction(org, mei!, "proposal", { done: true })).success, false, "not your own");
  viewerId = rao!;
  assert.match(String((await pg.decideMilestoneAction(org, mei!, "qualifying", { moveTo: "2026-09-01", reason: "" }) as { error?: string }).error), /reason/);
  assert.ok((await pg.decideMilestoneAction(org, mei!, "qualifying", { moveTo: "2026-09-01", reason: "Two months away" })).success);
  assert.ok((await pg.decideMilestoneAction(org, mei!, "proposal", { done: true })).success);
  // A new start date moves only untouched milestones.
  assert.ok((await pg.setProgressAction(org, mei!, { startDate: "2024-10-01", partTime: false, coSupervisorId: null, weeks: 2 })).success);
  const after2 = await pg.readProgressAction(org, mei!);
  const byKey = after2.success && after2.set ? Object.fromEntries(after2.milestones.map((m) => [m.key, m])) : {};
  assert.equal(byKey["qualifying"]?.dueOn, "2026-09-01", "a moved milestone keeps its date");
  assert.equal(byKey["submission"]?.dueOn, "2028-04-01");
  assert.equal(byKey["proposal"]?.state, "done");
  // The leads' list: dates only.
  const all = await pg.readLabProgressAction(org);
  assert.ok(all.success && all.rows.length === 2 && all.rows.every((r) => !("notes" in r)));
  viewerId = mei!;
  assert.equal((await pg.readLabProgressAction(org)).success, false);
  // Notices: once.
  const server = await loadAppModule(() => import("../../src/lib/organizations/lab-progress-server"));
  await server.progressNotices(new Date());
  const second = await server.progressNotices(new Date());
  assert.equal(second.sent, 0);
});
