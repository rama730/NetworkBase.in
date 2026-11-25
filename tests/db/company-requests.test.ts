import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.5 (report 33.6): requests to central teams — only teams that switch it on; anyone in the company but Viewers
// asks; the asker sees My asks (never the board); No reopens; outside people refused.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.238" }) });

let req: typeof import("../../src/app/actions/company-requests");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  req = await loadAppModule(() => import("../../src/app/actions/company-requests"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("33.6: a team takes requests from the company; members ask, follow them in My asks and answer Did this solve it?", async () => {
  const [owner, lead, asker, guest, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${lead!}, 'member'), (${id}, ${asker!}, 'member'), (${id}, ${guest!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const it = await sql.begin((tx) => createProject(tx, lead!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'IT', workflows_enabled = true WHERE id = ${it}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${it}, ${lead!}, 'owner')`;

  viewerId = asker!;
  let teams = await req.readAskableTeamsAction(id);
  assert.ok(teams.success && teams.teams.length === 0, "a team takes company requests only when it switches it on");
  viewerId = lead!;
  assert.match((await req.setCompanyRequestsAction(it, true) as { error: string }).error, /Add Requests/);
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${it}, 'requests', ${lead!})`;
  viewerId = asker!;
  assert.equal((await req.setCompanyRequestsAction(it, true)).success, false, "the team's owner or admins switch it on");
  viewerId = lead!;
  assert.equal((await req.setCompanyRequestsAction(it, true)).success, true);

  viewerId = asker!;
  teams = await req.readAskableTeamsAction(id);
  assert.ok(teams.success && teams.teams.length === 1);
  const type = teams.teams[0]!.types[0]!;
  const answers = Object.fromEntries(type.questions.filter((q) => q.kind !== "file").map((q) => [q.id, q.kind === "choice" ? q.options![0]! : q.kind === "date" ? "2026-12-01" : "A laptop"]));
  const asked = await req.askTeamAction(id, { teamId: it, typeId: type.id, title: "New laptop for Mei", answers });
  assert.ok(asked.success, JSON.stringify(asked));
  const [task] = await sql`SELECT workspace_id, creator_id, item_type, stage, type_fields->>'fromCompany' AS from_company FROM tasks WHERE id = ${asked.id}`;
  assert.deepEqual([task!.workspace_id, task!.creator_id, task!.item_type, task!.stage, task!.from_company], [it, asker!, "request", "new", id]);
  const mine = await req.readMyAsksAction(id);
  assert.ok(mine.success);
  assert.deepEqual(mine.asks.map((a) => [a.title, a.team, a.stageWord]), [["New laptop for Mei", "IT", "New"]]);

  viewerId = guest!;
  assert.equal((await req.askTeamAction(id, { teamId: it, typeId: type.id, title: "x", answers })).success, false, "Viewers don't ask");
  viewerId = outsider!;
  assert.equal((await req.readAskableTeamsAction(id)).success, false, "no requests from outside people");

  // The team accepts: the company asker is told, with a link to the company (My asks), not the team's board.
  const { notifyRequestDecided } = await import("../../src/lib/workflows/request-notify");
  await notifyRequestDecided(asked.id, lead!, "Accepted");
  const [told] = await sql`SELECT href FROM user_notifications WHERE user_id = ${asker!} AND title = ${"Accepted: New laptop for Mei"}`;
  assert.ok(told, "the asker is told");
  assert.match(String(told!.href), /^\/org\//);
  viewerId = asker!;
  assert.match((await req.answerMyAskAction(id, asked.id, { solved: "yes" }) as { error: string }).error, /once it’s delivered/);
  await sql`UPDATE tasks SET stage = 'delivered', status = 'done' WHERE id = ${asked.id}`;
  viewerId = lead!;
  assert.equal((await req.answerMyAskAction(id, asked.id, { solved: "yes" })).success, false, "only the asker answers");
  viewerId = asker!;
  assert.match((await req.answerMyAskAction(id, asked.id, { solved: "no" }) as { error: string }).error, /still missing/);
  assert.equal((await req.answerMyAskAction(id, asked.id, { solved: "no", note: "It has no charger" })).success, true);
  const [after] = await sql`SELECT stage, type_fields->>'reopenCount' AS reopens, type_fields->>'notSolvedNote' AS note FROM tasks WHERE id = ${asked.id}`;
  assert.deepEqual([after!.stage, after!.reopens, after!.note], ["in_progress", "1", "It has no charger"], "No reopens it, with what's missing");
});
