import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §41.3 deploy 1a (privacy): one test per problem, each failing before its fix.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.14" }) });

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let dash: typeof import("../../src/app/actions/org-dashboard");
let cards: typeof import("../../src/lib/messaging/cards");
let access: typeof import("../../src/lib/data/workspace-access");
let files: typeof import("../../src/lib/files/internal-helpers");
let appDb: typeof import("../../src/lib/db");
let schema: typeof import("../../src/lib/db/schema");
let orm: typeof import("drizzle-orm");
let comments: typeof import("../../src/app/actions/task-comment");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null }),
  });
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  cards = await loadAppModule(() => import("../../src/lib/messaging/cards"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  files = await loadAppModule(() => import("../../src/lib/files/internal-helpers"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
  schema = await loadAppModule(() => import("../../src/lib/db/schema"));
  orm = await import("drizzle-orm");
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Org = { org: string; owner: string; admin: string; a: string; b: string };

async function org(): Promise<Org> {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, task_review_required = true WHERE id = ${id}`;
  created.push(id);
  return { org: id, owner: owner!, admin: admin!, a: a!, b: b! };
}

const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

async function draft(o: Org, title: string) {
  viewerId = o.owner;
  const result = await assignments.createAssignmentAction({ projectId: o.org, title, dueDate: future(), publish: false, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.masterId : "";
}

async function boardTitles(o: Org, as: string) {
  viewerId = as;
  const board = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.equal(board.success, true, JSON.stringify(board));
  return board.success ? board.tasks.map((t) => t.title).sort() : [];
}

async function databaseRule(as: string, taskId: string, orgId: string, path: string) {
  // Browsers can't call nb_org_node_access_ok directly, so only the identity is set: auth.uid() is `as`.
  return inRollback(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: as, role: "authenticated" })}, true)`;
    const [row] = await tx`SELECT app_private.nb_task_visible(${taskId}) AS task, app_private.nb_org_node_access_ok(${orgId}, ${taskId}, ${path}) AS node`;
    return row;
  });
}

async function nodeVisibleTo(o: Org, as: string, nodeId: string) {
  const viewerAccess = await access.getWorkspaceAccessById(o.org, as);
  const { workspaceNodes } = schema;
  const rows = await appDb.db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(orm.and(orm.eq(workspaceNodes.id, nodeId), files.orgFileAccessSql(viewerAccess)));
  return rows.length === 1;
}

test("problem 1: a draft assignment and its files stay hidden from members, on the board, Overview, files, chat and the database rule", async () => {
  const o = await org();
  const master = await draft(o, "Exam answers");
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO1', now() - interval '1 day', now() + interval '6 days', 'active') RETURNING id`;
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${master}`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, task_id) VALUES (${o.org}, 'file', 'key.pdf', '/key.pdf', ${master}) RETURNING id`;

  // Board
  assert.deepEqual(await boardTitles(o, o.a), [], "members don't see a draft on the board");
  assert.deepEqual(await boardTitles(o, o.admin), ["Exam answers"], "admins do");

  // Overview: This sprint and activity
  viewerId = o.a;
  const overview = await dash.readOrgDashboardAction(o.org);
  assert.equal(overview.success, true, JSON.stringify(overview));
  if (overview.success) {
    assert.equal(overview.thisSprint.items.some((i) => i.masterId === master), false, "This sprint leaves the draft out");
    assert.equal(overview.activity.some((e) => e.text.includes("Exam answers")), false, "activity doesn't say it was assigned");
  }

  // Files: the server rule and the database rule
  assert.equal(await nodeVisibleTo(o, o.a, node!.id), false, "a draft's file is hidden from members");
  assert.equal(await nodeVisibleTo(o, o.admin, node!.id), true);
  assert.deepEqual({ ...(await databaseRule(o.a, master, o.org, "/key.pdf")) }, { task: false, node: false });
  assert.deepEqual({ ...(await databaseRule(o.admin, master, o.org, "/key.pdf")) }, { task: true, node: true });

  // Chat: an assignment card and a task card for the draft
  const memberCards = await cards.hydrateCards(o.a, [{ kind: "assignment", ref_id: master }, { kind: "task", ref_id: master }]);
  assert.equal((memberCards[`assignment:${master}`] as { restricted?: boolean }).restricted, true);
  assert.equal((memberCards[`task:${master}`] as { restricted?: boolean }).restricted, true);

  // Once published, members see it everywhere.
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  assert.deepEqual(await boardTitles(o, o.a), ["Exam answers", "Exam answers"], "the master and their own copy");
  assert.equal(await nodeVisibleTo(o, o.a, node!.id), true);
  assert.deepEqual({ ...(await databaseRule(o.a, master, o.org, "/key.pdf")) }, { task: true, node: true });
  const published = await cards.hydrateCards(o.a, [{ kind: "assignment", ref_id: master }]);
  assert.equal((published[`assignment:${master}`] as { restricted?: boolean }).restricted, undefined);
});

test("problem 1: another student's copy never shows on a chat task card", async () => {
  const o = await org();
  const master = await draft(o, "Lab 1");
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  const [copyB] = await sql`SELECT id FROM tasks WHERE assignment_id = ${master} AND assignee_id = ${o.b}`;
  const seenByA = await cards.hydrateCards(o.a, [{ kind: "task", ref_id: copyB!.id }]);
  assert.equal((seenByA[`task:${copyB!.id}`] as { restricted?: boolean }).restricted, true);
  const seenByB = await cards.hydrateCards(o.b, [{ kind: "task", ref_id: copyB!.id }]);
  assert.equal((seenByB[`task:${copyB!.id}`] as { restricted?: boolean }).restricted, undefined);
});

async function published(o: Org, title: string) {
  const master = await draft(o, title);
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  const rows = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${master}`;
  const copyOf = (user: string) => rows.find((r) => r.assignee_id === user)!.id as string;
  return { master, copyOf };
}

test("comment privacy (decision 37): another person's copy can't be read, commented on or used to mention, and mentions reach only people who can see the work", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 2");
  viewerId = o.b;
  assert.equal((await comments.createTaskCommentAction(copyOf(o.b), o.org, "Is this right?")).success, true);

  viewerId = o.a;
  const read = await comments.readTaskDiscussionAction(o.org, copyOf(o.b));
  assert.equal(read.success, false, "a classmate can't read the private conversation");
  assert.equal((await comments.createTaskCommentAction(copyOf(o.b), o.org, "Copying yours")).success, false, "or write in it");

  const { buildMentionToken } = await import("../../src/lib/workspaces/mention-tokens");
  const onOwn = await comments.createTaskCommentAction(copyOf(o.a), o.org, `Help ${buildMentionToken({ userId: o.b, displayName: "B" })}`);
  assert.equal(onOwn.success, true, JSON.stringify(onOwn));
  const [mentioned] = await sql`SELECT count(*)::int AS n FROM comment_mentions cm JOIN task_comments c ON c.id = cm.comment_id WHERE c.task_id = ${copyOf(o.a)} AND cm.mentioned_user_id = ${o.b}`;
  assert.equal(mentioned!.n, 0, "a classmate who can't see this copy isn't mentioned");

  viewerId = o.admin;
  assert.equal((await comments.readTaskDiscussionAction(o.org, copyOf(o.b))).success, true, "admins read every copy's conversation");
});

test("decision 53: a suspension's reason goes only to the owner and admins", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET suspended_at = now(), suspend_reason = 'Spam reports from three people' WHERE id = ${o.org}`;
  const { readOrgDetail } = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  const member = await readOrgDetail(o.org, { userId: o.a, isAdmin: false, isInOrg: true });
  const admin = await readOrgDetail(o.org, { userId: o.admin, isAdmin: true, isInOrg: true });
  assert.equal(member?.suspended, true, "members still see that it's suspended");
  assert.equal(member?.suspendReason, null);
  assert.equal(admin?.suspendReason, "Spam reports from three people");
});

test("decision 62: Members shows Last active here, never the account-wide time; opening the org or a workspace in it stamps it, at most hourly", async () => {
  const o = await org();
  await sql`UPDATE profiles SET last_active_at = now() WHERE id = ${o.a}`;
  const members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  const { stampLastActiveHere } = await loadAppModule(() => import("../../src/lib/organizations/members"));
  const rowOf = async (user: string) => {
    viewerId = o.admin;
    const r = await members.readOrgMembersAction(o.org);
    assert.equal(r.success, true, JSON.stringify(r));
    return r.success ? r.rows.find((row) => row.userId === user)! : null;
  };
  const before = await rowOf(o.a);
  assert.equal(before?.lastActiveAt, null, "account-wide activity isn't shown");
  assert.equal(before?.inactive, false, "an empty value doesn't make someone inactive");

  const child = await sql.begin((tx) => createProject(tx, o.a));
  created.push(child);
  await sql`UPDATE workspaces SET parent_id = ${o.org} WHERE id = ${child}`;
  await stampLastActiveHere(child, o.a);
  const [first] = await sql`SELECT last_active_here_at AS at FROM workspace_members WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  assert.ok(first!.at, "opening a workspace in the org counts");
  await sql`UPDATE workspace_members SET last_active_here_at = now() - interval '30 minutes' WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  await stampLastActiveHere(o.org, o.a);
  const [second] = await sql`SELECT last_active_here_at > now() - interval '1 minute' AS fresh FROM workspace_members WHERE workspace_id = ${o.org} AND user_id = ${o.a}`;
  assert.equal(second!.fresh, false, "no new write within the hour");
  assert.ok((await rowOf(o.a))?.lastActiveAt);
});

test("decision 69: the sitemap and page indexing use Discover's rule, so a new public organization isn't indexed until it qualifies", async () => {
  // Dates sit after the rule's start (2026-11-03) so the test doesn't depend on today.
  const fresh = await org();
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"fresh-" + fresh.org.slice(0, 8)}, created_at = GREATEST(now(), '2026-11-04'::timestamptz) WHERE id = ${fresh.org}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${fresh.org} AND role <> 'owner'`;
  const grown = await org();
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"grown-" + grown.org.slice(0, 8)}, created_at = now() - interval '10 days' WHERE id = ${grown.org}`;
  const old = await org();
  await sql`UPDATE workspaces SET visibility = 'public', status = 'active', slug = ${"old-" + old.org.slice(0, 8)}, created_at = '2026-01-01' WHERE id = ${old.org}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${old.org} AND role <> 'owner'`;

  const { default: sitemap } = await loadAppModule(() => import("../../src/app/sitemap"));
  const urls = (await sitemap()).map((entry) => entry.url).join(" ");
  assert.equal(urls.includes(`fresh-${fresh.org.slice(0, 8)}`), false, "too new and too small: not listed");
  assert.equal(urls.includes(`grown-${grown.org.slice(0, 8)}`), true, "3 members and 7 days: listed");
  assert.equal(urls.includes(`old-${old.org.slice(0, 8)}`), true, "public before the rule: stays listed (§41.4)");

  const { orgIndexableSql, orgQualifiesSql } = await loadAppModule(() => import("../../src/lib/discover/listed-sql"));
  const { workspaces } = schema;
  const rows = await appDb.db.select({ id: workspaces.id, index: orgIndexableSql(), discover: orgQualifiesSql() }).from(workspaces)
    .where(orm.inArray(workspaces.id, [fresh.org, grown.org, old.org]));
  const by = Object.fromEntries(rows.map((r) => [r.id, [r.index, r.discover]]));
  assert.deepEqual(by[fresh.org], [false, false], "the share page and Discover agree on a new one");
  assert.deepEqual(by[grown.org], [true, true]);
  assert.deepEqual(by[old.org], [true, false], "an old small one stays indexed but was never on Discover");
});
