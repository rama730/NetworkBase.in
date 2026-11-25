import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.3b (report 32.4 call 2): hand in a unit or lesson from your own course — written into the hand-in as it is,
// frozen as a version, with a link back to it.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.199" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let handIn: typeof import("../../src/app/actions/plan-hand-in");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  handIn = await loadAppModule(() => import("../../src/app/actions/plan-hand-in"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});
test("hand in a unit from my course: frozen text with its lessons; only my own courses; not on a link hand-in", async () => {
  const [principal, teacher, other] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const mk = async (owner: string) => {
    const id = await sql.begin((tx) => createProject(tx, owner));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const school = await mk(principal!);
  await sql`UPDATE workspaces SET org_level = 'institution' WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${teacher!}, 'member'), (${school}, ${other!}, 'member')`;
  const course = await mk(teacher!);
  const theirs = await mk(other!);
  await sql`UPDATE workspaces SET institution_id = ${school}, title = 'Grade 6 Science' WHERE id IN (${course}, ${theirs})`;
  const [unit] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${course}, 1, 'Forces', '2026-09-01', '2026-09-20', 'active') RETURNING id`;
  const [week] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${course}, 2, 'Week 1', '2026-09-01', '2026-09-06', 'active', ${unit!.id}) RETURNING id`;
  const [lesson] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, item_type, stage, sprint_id, on_board, type_fields, creator_id)
    VALUES (${course}, 'Balanced forces', 'todo', 'medium', 'class_lesson', 'draft', ${week!.id}, false, ${sql.json({ lessonType: "activity", during: "Ramps and trolleys", standards: ["SC6.3"] })}, ${teacher!}) RETURNING id`;
  const [theirUnit] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${theirs}, 1, 'Not mine', '2026-09-01', '2026-09-20', 'active') RETURNING id`;

  viewerId = principal!;
  const ask = async (type: "text" | "link") => {
    const made = await assignments.createAssignmentAction({ projectId: school, title: `Unit plan ${type}`, dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
      submissionType: type, reviewRequired: true, lateRule: "none", target: { mode: "people", userIds: [teacher!] }, steps: [] });
    assert.ok(made.success, JSON.stringify(made));
    return (await sql`SELECT id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""}`)[0]!.id as string;
  };
  const copy = await ask("text");
  const linkCopy = await ask("link");

  viewerId = teacher!;
  const items = await handIn.readMyPlanItemsAction(copy);
  assert.ok(items.success);
  assert.deepEqual(items.courses.map((c) => [c.course, c.units.map((u) => [u.name, u.lessons.map((l) => l.title)])]), [["Grade 6 Science", [["Forces", ["Balanced forces"]]]]], "only my courses");
  assert.equal((await handIn.submitPlanItemAction(copy, { kind: "unit", id: theirUnit!.id })).success, false, "not someone else's unit");
  assert.equal((await handIn.submitPlanItemAction(linkCopy, { kind: "unit", id: unit!.id })).success, false, "a link hand-in takes a link");
  assert.equal((await handIn.submitPlanItemAction(copy, { kind: "unit", id: unit!.id })).success, true);
  const [c] = await sql`SELECT review_status, submission, type_fields FROM tasks WHERE id = ${copy}`;
  assert.equal(c!.review_status, "pending");
  assert.match(c!.submission.text, /# Unit: Forces\nGrade 6 Science\n\n## Week 1\n- Balanced forces · Activity · Draft · SC6.3\n  In class: Ramps and trolleys/);
  assert.deepEqual([c!.type_fields.handedInItem.kind, c!.type_fields.handedInItem.id, c!.type_fields.handedInItem.label], ["unit", unit!.id, "Forces"]);
  // Frozen: later edits don't change what was handed in.
  await sql`UPDATE tasks SET title = 'Renamed later', updated_at = now() + interval '1 second' WHERE id = ${lesson!.id}`;
  const [again] = await sql`SELECT submission->>'text' AS text FROM tasks WHERE id = ${copy}`;
  assert.match(again!.text, /Balanced forces/);
  viewerId = other!;
  assert.equal((await handIn.submitPlanItemAction(copy, { kind: "unit", id: unit!.id })).success, false, "only the copy's holder");

  // The queue names the item and notices the later change; approving can mark its lessons Ready (call 4).
  viewerId = principal!;
  const queue = await assignments.readReviewQueueAction(school);
  assert.ok(queue.success);
  assert.deepEqual(queue.rows.find((r) => r.copyId === copy)?.item, { kind: "unit", label: "Forces", changedSince: true });
  assert.equal((await assignments.reviewAssignmentCopyAction(copy, "approve", undefined, undefined, { markReady: true })).success, true);
  assert.equal((await sql`SELECT stage FROM tasks WHERE id = ${lesson!.id}`)[0]!.stage, "ready");
});
