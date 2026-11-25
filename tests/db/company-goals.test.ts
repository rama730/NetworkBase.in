import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.3 (report 33.4): company and team goals together — progress only from key results, Supports one goal, Contributes
// to, project dates and status, private projects masked, outside people refused.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.236" }) });

let goals: typeof import("../../src/app/actions/company-goals");
let docActions: typeof import("../../src/app/actions/workspace/doc");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  goals = await loadAppModule(() => import("../../src/app/actions/company-goals"));
  docActions = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("33.4: goals cascade from company to team to project; progress only from key results; private projects masked", async () => {
  const [owner, lead, member, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${lead!}, 'member'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const team = await sql.begin((tx) => createProject(tx, lead!, { visibility: "public" }));
  const secret = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Sales APAC' WHERE id = ${team}`;
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Acquisition' WHERE id = ${secret}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${lead!}, 'owner')`;
  const period = (await import("../../src/lib/workflows/goals")).periodOf(new Date().toISOString().slice(0, 10), {});
  const goalsDoc = async (ws: string) => (await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, ${`goals-${ws.slice(0, 6)}`}, 'goals.md', ${sql.json({ section: "goals", period })}) RETURNING id`)[0]!.id as string;
  const item = async (ws: string, doc: string, type: string, title: string, fields: Record<string, unknown>, partOf: string | null = null) =>
    (await sql`INSERT INTO tasks (workspace_id, title, status, item_type, stage, type_fields, source_doc_id, part_of_id, creator_id) VALUES (${ws}, ${title}, 'todo', ${type}, 'active', ${sql.json(fields as never)}, ${doc}, ${partOf}, ${owner!}) RETURNING id`)[0]!.id as string;
  const cdoc = await goalsDoc(id), tdoc = await goalsDoc(team);
  const grow = await item(id, cdoc, "objective", "Grow revenue", { period });
  await item(id, cdoc, "key_result", "Bookings", { period, start: 0, target: 100, current: 50, direction: "increase" }, grow);
  const logos = await item(team, tdoc, "objective", "40 new logos", { period });
  await item(team, tdoc, "key_result", "Logos", { period, start: 0, target: 40, current: 10, direction: "increase" }, logos);

  viewerId = member!;
  assert.equal((await goals.setContributesToAction(team, logos, grow)).success, false, "the team's owner and admins link goals");
  viewerId = lead!;
  assert.equal((await goals.setContributesToAction(team, logos, grow)).success, true);
  assert.equal((await goals.setProjectSupportsAction(team, logos)).success, true);
  assert.match((await goals.setProjectDatesAction(team, { start: "2026-12-01", end: "2026-11-01" }) as { error: string }).error, /before the start/);
  assert.equal((await goals.setProjectDatesAction(team, { start: "2026-09-01", end: "2026-12-15" })).success, true);
  assert.equal((await goals.postProjectStatusAction(team, { status: "at_risk", line: "Hiring slipped two weeks" })).success, true);
  viewerId = owner!;
  assert.equal((await goals.setProjectSupportsAction(secret, grow)).success, true);
  await goals.postProjectStatusAction(secret, { status: "on_track", line: "Due diligence going well" });

  viewerId = member!;
  const d = await goals.readCompanyGoalsAction(id);
  assert.ok(d.success);
  const g = (t: string) => d.goals.find((x) => x.title === t)!;
  assert.deepEqual([g("Grow revenue").progress, g("40 new logos").progress, g("40 new logos").contributesTo], [50, 25, grow], "progress from key results only; the link adds nothing");
  const sales = d.projects.find((p) => p.title === "Sales APAC")!;
  assert.deepEqual([sales.supports, sales.start, sales.status?.status, sales.status?.line], [logos, "2026-09-01", "at_risk", "Hiring slipped two weeks"]);
  const masked = d.projects.find((p) => p.masked)!;
  assert.deepEqual([masked.title, masked.slug, masked.status?.status], ["Private project", null, "on_track"], "outside it: the name is hidden, the status shows");
  assert.equal(JSON.stringify(d).includes("Acquisition"), false);
  // A private team's own goals stay with its people (security review): add one and check a member can't see it.
  const sdoc = await goalsDoc(secret);
  await item(secret, sdoc, "objective", "Buy a rival", { period });
  const again = await goals.readCompanyGoalsAction(id);
  assert.ok(again.success);
  assert.equal(again.goals.some((x) => x.title === "Buy a rival"), false);
  // The company's goals document while a draft: admins only.
  await sql`UPDATE workspace_documents SET settings = settings || '{"org":{"lifecycle":"draft"}}'::jsonb WHERE id = ${cdoc}`;
  const draft = await goals.readCompanyGoalsAction(id);
  assert.ok(draft.success);
  assert.equal(draft.goals.some((x) => x.title === "Grow revenue"), false);
  await sql`UPDATE workspace_documents SET settings = settings || '{"org":{"lifecycle":"published"}}'::jsonb WHERE id = ${cdoc}`;
  assert.deepEqual(d.notLinked, [], "Not linked is for admins");
  const update = await sql`SELECT content FROM workspace_updates WHERE workspace_id = ${team}`;
  assert.match(String(update[0]?.content), /Status: At risk — Hiring slipped/, "the status is also an Update");

  viewerId = outsider!;
  assert.equal((await goals.readCompanyGoalsAction(id)).success, false, "outside people see no company goals");
  viewerId = owner!;
  const admin = await goals.readCompanyGoalsAction(id);
  assert.ok(admin.success);
  assert.ok(admin.projects.some((p) => p.title === "Acquisition"), "admins see every project");
  assert.ok(admin.goals.some((x) => x.title === "Buy a rival"), "and every goal");
});

test("33.4 call 1 (live check): a company adds objectives and key results to its goals document with no workflow", async () => {
  const [owner] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const period = (await import("../../src/lib/workflows/goals")).periodOf(new Date().toISOString().slice(0, 10), {});
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'goals-q', 'goals-q.md', ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "members_only", externalImages: false, projectBlocks: true, section: "goals", period })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, '# Goals', 'g') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  viewerId = owner!;
  const o = await docActions.addObjectiveAction(id, { docSlug: "goals-q", title: "Grow revenue" });
  assert.ok(o.success, JSON.stringify(o));
  const kr = await docActions.addKeyResultAction(id, { docSlug: "goals-q", objectiveId: (o as { id: string }).id, title: "Bookings", direction: "increase", unit: "$k", start: 0, target: 500 });
  assert.ok(kr.success, JSON.stringify(kr));
  const read = await goals.readCompanyGoalsAction(id);
  assert.ok(read.success);
  assert.deepEqual(read.goals.map((g) => g.title), ["Grow revenue"]);
});
