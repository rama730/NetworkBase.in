import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.8c (report 30.6 W5): the coordinator's Theses table (numbers only, staff only) and the no-supervision notice.
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

let coord: typeof import("../../src/app/actions/thesis-coordinator");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  coord = await loadAppModule(() => import("../../src/app/actions/thesis-coordinator"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const SETTINGS = { version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true };

test("the Theses table: numbers only for class staff, Overdue and a no-supervision flag; the notice goes once to student and supervisor", async () => {
  const [teacher, ta, student, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin'), (${klass}, ${student!}, 'member'), (${klass}, ${other!}, 'member')`;
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  created.push(ws);
  await sql`UPDATE workspaces SET parent_id = ${klass}, title = 'Graph nets for traffic', workflow_settings = ${sql.json({ thesis: { supervisorId: ta!, questions: [] } } as never)} WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student!}, 'owner')`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by, added_at) VALUES (${ws}, 'thesis', ${student!}, now() - interval '90 days')`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, 'intro', 'intro.md', ${sql.json({ ...SETTINGS, section: "chapters", chapter: { number: 1, target: 4000, status: "in_progress" } } as never)}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${ws}, ${d!.id}, 1, '# 1. Intro\n\nSecret thesis sentence here.', 'h') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, 'sup', 'sup.md', ${sql.json({ ...SETTINGS, section: "meetings", kind: "supervision", date: ago(45) } as never)})`;
  await sql`WITH m AS (INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind) VALUES (${klass}, 'Literature review', 'todo', 'medium', ${teacher!}, 'assignment') RETURNING id)
    INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, due_date)
    SELECT ${ws}, 'Literature review', 'todo', 'medium', ${teacher!}, 'task', m.id, ${student!}, now() - interval '2 days' FROM m`;
  viewerId = teacher!;
  const r = await coord.readThesisCoordinatorAction(klass);
  assert.ok(r.success);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0]!;
  assert.deepEqual([row.title, row.words, row.target, row.milestone?.title, row.milestone?.overdue, row.daysSince, row.noSupervision], ["Graph nets for traffic", 6, 4000, "Literature review", true, 45, true]);
  assert.ok(row.supervisor);
  assert.equal(JSON.stringify(r).includes("Secret thesis"), false, "numbers, never thesis text");
  viewerId = other!;
  assert.equal((await coord.readThesisCoordinatorAction(klass)).success, false, "students don't see the table");
  const server = await loadAppModule(() => import("../../src/lib/workflows/thesis-server"));
  await server.notifyNoSupervision();
  await server.notifyNoSupervision();
  const notices = await sql`SELECT user_id FROM user_notifications WHERE title = 'Graph nets for traffic: no supervision in 30 days'`;
  assert.deepEqual(notices.map((n) => n.user_id).sort(), [student!, ta!].sort(), "once each, to the student and the supervisor");
});
