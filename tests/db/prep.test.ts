import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.4b (report 31.4 calls 8–9): Syllabus stages are each learner's own (staff see counts); mistakes are private and
// reach the learner's mentor only when shared; an agent may log a mistake for the learner.
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.191" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/prep");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/prep"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("syllabus stages are the learner's own; mistakes are private until shared with the mentor", async () => {
  const [teacher, mentor, learner, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${mentor!}, 'admin'), (${klass}, ${learner!}, 'member'), (${klass}, ${other!}, 'member')`;
  const [group] = await sql`INSERT INTO class_sections (workspace_id, name, kind) VALUES (${klass}, 'G', 'mentor') RETURNING id`;
  await sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind, created_at) VALUES (${group!.id}, ${klass}, ${mentor!}, 'ta', 'mentor', now() - interval '1 day'), (${group!.id}, ${klass}, ${learner!}, 'student', 'mentor', now() - interval '1 day')`;

  viewerId = learner!;
  assert.equal((await act.saveTopicsAction(klass, ["Reading"])).success, false, "staff list topics");
  viewerId = teacher!;
  assert.equal((await act.saveTopicsAction(klass, ["True / False / Not given", "Matching headings", "  ", "Matching headings"])).success, true);
  const staffView = await act.readSyllabusAction(klass);
  assert.ok(staffView.success && staffView.staff);
  assert.deepEqual(staffView.topics.map((t) => t.name), ["True / False / Not given", "Matching headings"]);
  const tfng = staffView.topics[0]!.id;

  viewerId = learner!;
  assert.equal((await act.setTopicStageAction(klass, tfng, "learning")).success, true);
  const mine = await act.readSyllabusAction(klass);
  assert.ok(mine.success && !mine.staff);
  assert.deepEqual(mine.topics.map((t) => t.stage), ["learning", "not_started"]);
  viewerId = teacher!;
  const counts = await act.readSyllabusAction(klass);
  assert.ok(counts.success && counts.staff);
  assert.equal(counts.topics[0]!.counts.learning, 1, "staff see counts only");

  // Mistakes: an agent may log one for the learner; private until shared; weak topics from 2+ in 30 days.
  viewerId = learner!;
  token = "agent";
  assert.equal((await act.logMistakeAction(klass, { topicId: tfng, reason: "misread", note: "Not given vs False" })).success, true);
  assert.equal((await act.shareMistakeAction(klass, "00000000-0000-0000-0000-000000000000", true)).success, false, "tokens never share");
  token = null;
  assert.equal((await act.logMistakeAction(klass, { topicId: tfng, reason: "concept" })).success, true);
  const own = await act.readMistakesAction(klass, null);
  assert.ok(own.success && own.own);
  assert.deepEqual(own.weak.map((w) => [w.name, w.mistakes]), [["True / False / Not given", 2]]);
  viewerId = mentor!;
  const before1 = await act.readMistakesAction(klass, learner!);
  assert.ok(before1.success);
  assert.equal(before1.mistakes.length, 0, "the mentor sees nothing until shared");
  viewerId = learner!;
  assert.equal((await act.shareMistakeAction(klass, own.mistakes[0]!.id, true)).success, true);
  viewerId = mentor!;
  const after1 = await act.readMistakesAction(klass, learner!);
  assert.ok(after1.success);
  assert.equal(after1.mistakes.length, 1);
  viewerId = teacher!;
  assert.equal((await act.readMistakesAction(klass, learner!)).success, false, "the Teacher never reads mistakes");
  viewerId = other!;
  assert.equal((await act.readMistakesAction(klass, learner!)).success, false);
});
