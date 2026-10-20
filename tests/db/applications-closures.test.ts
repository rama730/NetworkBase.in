import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId, user_metadata: {} } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let apps: typeof import("../../src/app/actions/applications");
let lifecycle: typeof import("../../src/lib/projects/server/lifecycle");
before(async () => {
  apps = await loadAppModule(() => import("../../src/app/actions/applications"));
  lifecycle = await loadAppModule(() => import("../../src/lib/projects/server/lifecycle"));
});
after(async () => { await sql.end(); await closeAppDb(); });

type Ctx = { owner: string; admin: string; one: string; two: string; projectId: string; roleA: string; roleB: string; a1: string; a2: string };

/** A project with two roles and two pending applicants (one per role), an owner and an admin. */
async function withTwoApplications(fn: (ctx: Ctx) => Promise<void>) {
  const [owner, admin, one, two] = await Promise.all([0, 1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const projectId = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => { await addMember(tx, projectId, owner!, "owner"); await addMember(tx, projectId, admin!, "admin"); });
  const [a] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${projectId}, 'Designer', 3) RETURNING id`;
  const [b] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${projectId}, 'Engineer', 3) RETURNING id`;
  try {
    viewerId = one!;
    const first = await apps.applyToRoleAction(projectId, a!.id as string, "designer here");
    viewerId = two!;
    const second = await apps.applyToRoleAction(projectId, b!.id as string, "engineer here");
    assert.ok(first.success && second.success, JSON.stringify([first, second]));
    await fn({ owner: owner!, admin: admin!, one: one!, two: two!, projectId, roleA: a!.id as string, roleB: b!.id as string, a1: first.applicationId!, a2: second.applicationId! });
  } finally {
    await sql`DELETE FROM project_invitations WHERE project_id = ${projectId}`;
    await sql`DELETE FROM role_applications WHERE project_id = ${projectId}`;
    await sql`DELETE FROM chat_channels WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_open_roles WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

const state = async (id: string) => (await sql`SELECT status, decision_reason_code FROM role_applications WHERE id = ${id}`)[0]!;
const lines = async (applicationId: string) => (await sql`SELECT m.body FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.application_id = ${applicationId} AND m.kind = 'system'`).map((row) => String(row.body));
const notices = async (userId: string, applicationId: string) => (await sql`SELECT title FROM user_notifications WHERE user_id = ${userId} AND (entity_refs->>'applicationId') = ${applicationId}`).map((row) => String(row.title));

test("archiving a project closes its pending applications and tells each applicant", async () => {
  await withTwoApplications(async ({ owner, one, two, projectId, a1, a2 }) => {
    viewerId = owner;
    const result = await lifecycle.archiveProjectAction(projectId);
    assert.equal(result.success, true, JSON.stringify(result));
    for (const id of [a1, a2]) {
      assert.deepEqual({ ...(await state(id)) }, { status: "rejected", decision_reason_code: "project_closed" });
      assert.ok((await lines(id)).some((line) => /no longer taking applications/.test(line)));
    }
    assert.ok((await notices(one, a1)).some((title) => /no longer taking applications/.test(title)), JSON.stringify(await notices(one, a1)));
    assert.ok((await notices(two, a2)).length >= 1);
  });
});

test("removing a role closes only that role's applications; lowering a count to what is filled does too", async () => {
  await withTwoApplications(async ({ owner, one, two, projectId, roleA, roleB, a1, a2 }) => {
    viewerId = owner;
    const removed = await lifecycle.updateProject(projectId, { roles: [{ id: roleB, role: "Engineer", count: 3 }], deletedRoleIds: [roleA] });
    assert.equal(removed.success, true, JSON.stringify(removed));
    assert.deepEqual({ ...(await state(a1)) }, { status: "rejected", decision_reason_code: "role_removed" });
    assert.equal((await state(a2)).status, "pending", "the other role's applicant keeps waiting");
    assert.ok((await notices(one, a1)).some((title) => /role you applied for was removed/.test(title)));

    // The role fills (count lowered to what is filled): the remaining applicant is closed.
    await sql`UPDATE project_open_roles SET filled = 1 WHERE id = ${roleB}`;
    const lowered = await lifecycle.updateProject(projectId, { roles: [{ id: roleB, role: "Engineer", count: 1 }] });
    assert.equal(lowered.success, true, JSON.stringify(lowered));
    assert.deepEqual({ ...(await state(a2)) }, { status: "rejected", decision_reason_code: "role_filled" });
    void two;
  });
});

test("a pending invitation blocks applying; joining another way closes the pending application", async () => {
  await withTwoApplications(async ({ owner, one, projectId, roleA, a1 }) => {
    const stranger = await sql.begin((tx) => createUser(tx));
    await sql`INSERT INTO project_invitations (project_id, inviter_id, candidate_id, kind, role_id, role_title, project_title, status, expires_at)
      VALUES (${projectId}, ${owner}, ${stranger}, 'ordinary_role', ${roleA}, 'Designer', 'P', 'pending', now() + interval '1 day')`;
    viewerId = stranger;
    const blocked = await apps.applyToRoleAction(projectId, roleA, "hello");
    assert.equal(blocked.success, false);
    assert.match(blocked.error ?? "", /invitation/i);

    // The applicant joins through an invitation: their pending application is closed as accepted.
    const { addProjectMemberInternal } = await loadAppModule(() => import("../../src/lib/projects/collaborator-lifecycle"));
    const { db } = await loadAppModule(() => import("../../src/lib/db"));
    await db.transaction((tx: never) => addProjectMemberInternal(tx, { projectId, userId: one, actorId: owner, source: "project_invite" }));
    assert.equal((await state(a1)).status, "accepted");
    assert.ok((await lines(a1)).some((line) => /joined the project/.test(line)));
  });
});

test("reopen refuses a closed role; a second reviewer is told who already decided; notes are length-checked; blocks stop decisions", async () => {
  await withTwoApplications(async ({ owner, admin, one, two, roleA, a1, a2, projectId }) => {
    viewerId = owner;
    assert.equal((await apps.rejectApplicationAction(a1, undefined, "skills_mismatch")).success, true);
    viewerId = admin;
    const late = await apps.rejectApplicationAction(a1, "me too", "other");
    assert.equal(late.success, false);
    assert.equal(late.errorCode, "ALREADY_PROCESSED");
    assert.match(late.error ?? "", /Already declined/);
    assert.equal((await state(a1)).decision_reason_code, "skills_mismatch", "the first decision's reason stands");

    await sql`UPDATE project_open_roles SET filled = count WHERE id = ${roleA}`;
    const reopen = await apps.reopenApplicationAction(a1);
    assert.equal(reopen.success, false);
    assert.equal(reopen.errorCode, "ROLE_FULL");

    const tooLong = await apps.rejectApplicationAction(a2, "x".repeat(501), "other");
    assert.equal(tooLong.errorCode, "INVALID_INPUT");
    const withNote = await apps.rejectApplicationAction(a2, "not this time", "availability");
    assert.equal(withNote.success, true);
    const [row] = await sql`SELECT decision_reason_text FROM role_applications WHERE id = ${a2}`;
    assert.match(String(row!.decision_reason_text), /availability|schedule/i);
    assert.match(String(row!.decision_reason_text), /not this time/, "the note adds to the reason");

    // An admin cannot accept someone who blocked the project's lead.
    await sql`UPDATE project_open_roles SET filled = 0 WHERE id = ${roleA}`;
    await sql`UPDATE role_applications SET status = 'pending', decision_at = NULL, decision_by = NULL, decision_reason_code = NULL, decision_reason_text = NULL WHERE id = ${a1}`;
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${one}, ${owner}, 'blocked', ${one}, now())`;
    viewerId = admin;
    const accepted = await apps.acceptApplicationAction(a1);
    assert.equal(accepted.success, false, JSON.stringify(accepted));
    await sql`DELETE FROM connections WHERE requester_id = ${one} AND addressee_id = ${owner}`;
    void two; void projectId;
  });
});
