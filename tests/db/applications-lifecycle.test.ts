import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId, user_metadata: {} } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let apps: typeof import("../../src/app/actions/applications");
before(async () => {
  apps = await loadAppModule(() => import("../../src/app/actions/applications"));
});
after(async () => { await sql.end(); await closeAppDb(); });

type Ctx = { owner: string; applicant: string; projectId: string; roleId: string };

async function withProject(fn: (ctx: Ctx) => Promise<void>, options: { roleCount?: number } = {}) {
  const owner = await sql.begin((tx) => createUser(tx));
  const applicant = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  const [role] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${projectId}, 'Designer', ${options.roleCount ?? 2}) RETURNING id`;
  try {
    viewerId = applicant;
    await fn({ owner, applicant, projectId, roleId: role!.id as string });
  } finally {
    await sql`DELETE FROM project_invitations WHERE project_id = ${projectId}`;
    await sql`DELETE FROM role_applications WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_open_roles WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

const row = async (projectId: string, applicantId: string) => {
  const [r] = await sql`SELECT id, status, message, role_id, decision_reason_code FROM role_applications WHERE project_id = ${projectId} AND applicant_id = ${applicantId}`;
  return r;
};

test("a withdrawn applicant can apply again: the same row is revived", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    const first = await apps.applyToRoleAction(projectId, roleId, "first message");
    assert.equal(first.success, true, JSON.stringify(first));
    assert.equal((await apps.withdrawApplicationAction(first.applicationId!)).success, true);
    const again = await apps.applyToRoleAction(projectId, roleId, "second message");
    assert.equal(again.success, true, JSON.stringify(again));
    assert.equal(again.outcome, "resubmitted");
    assert.equal(again.applicationId, first.applicationId);
    const r = await row(projectId, applicant);
    assert.equal(r!.status, "pending");
    assert.equal(r!.message, "second message");
  });
});

test("a removed member whose application was accepted can apply again; a current member cannot", async () => {
  await withProject(async ({ owner, applicant, projectId, roleId }) => {
    const first = await apps.applyToRoleAction(projectId, roleId, "let me in");
    viewerId = owner;
    assert.equal((await apps.acceptApplicationAction(first.applicationId!)).success, true);
    viewerId = applicant;
    const asMember = await apps.applyToRoleAction(projectId, roleId, "again");
    assert.equal(asMember.success, false);
    assert.equal(asMember.errorCode, "ALREADY_MEMBER");
    await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${applicant}`;
    const back = await apps.applyToRoleAction(projectId, roleId, "I'd like to return");
    assert.equal(back.success, true, JSON.stringify(back));
    assert.equal(back.outcome, "resubmitted");
    assert.equal((await row(projectId, applicant))!.status, "pending");
  });
});

test("applying while pending: identical is a no-op, a change inside the edit window updates, outside it is refused", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    const first = await apps.applyToRoleAction(projectId, roleId, "hello");
    assert.equal(first.outcome, "submitted");
    const same = await apps.applyToRoleAction(projectId, roleId, "hello");
    assert.equal(same.success, true);
    assert.equal(same.outcome, "already_pending");
    const edited = await apps.applyToRoleAction(projectId, roleId, "hello, with more detail");
    assert.equal(edited.success, true, JSON.stringify(edited));
    assert.equal(edited.outcome, "updated");
    assert.equal((await row(projectId, applicant))!.message, "hello, with more detail");
    await sql`UPDATE role_applications SET created_at = now() - interval '1 hour' WHERE project_id = ${projectId}`;
    const late = await apps.applyToRoleAction(projectId, roleId, "a change after the window");
    assert.equal(late.success, false);
    assert.equal(late.errorCode, "ALREADY_PENDING");
    assert.equal((await row(projectId, applicant))!.message, "hello, with more detail", "nothing changed");
  });
});

test("two simultaneous first submits end as one application, never an error", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    const results = await Promise.all([
      apps.applyToRoleAction(projectId, roleId, "tab one", { idempotencyKey: "a" }),
      apps.applyToRoleAction(projectId, roleId, "tab two", { idempotencyKey: "b" }),
    ]);
    assert.deepEqual(results.map((r) => r.success), [true, true], JSON.stringify(results));
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM role_applications WHERE project_id = ${projectId} AND applicant_id = ${applicant}`;
    assert.equal(count, 1);
  });
});

async function fillPendingCap(applicant: string) {
  const extra: string[] = [];
  for (let i = 0; i < 20; i++) extra.push(await sql.begin(async (tx) => createProject(tx, await createUser(tx))));
  await sql`INSERT INTO role_applications (project_id, applicant_id, creator_id, status, message)
    SELECT id, ${applicant}, owner_id, 'pending', 'x' FROM projects WHERE id = ANY(${extra})`;
  return async () => {
    await sql`DELETE FROM role_applications WHERE project_id = ANY(${extra})`;
    await sql`DELETE FROM projects WHERE id = ANY(${extra})`;
  };
}

test("the 20-pending cap reports CAP_REACHED for apply and for reapply", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    const first = await apps.applyToRoleAction(projectId, roleId, "one");
    assert.equal((await apps.withdrawApplicationAction(first.applicationId!)).success, true);
    const release = await fillPendingCap(applicant);
    try {
      const again = await apps.applyToRoleAction(projectId, roleId, "again");
      assert.equal(again.success, false);
      assert.equal(again.errorCode, "CAP_REACHED");
      assert.equal((await row(projectId, applicant))!.status, "withdrawn", "a refused reapply changes nothing");
    } finally {
      await release();
    }
  });
  await withProject(async ({ applicant, projectId, roleId }) => {
    const release = await fillPendingCap(applicant);
    try {
      const fresh = await apps.applyToRoleAction(projectId, roleId, "new");
      assert.equal(fresh.errorCode, "CAP_REACHED");
    } finally {
      await release();
    }
  });
});

test("a deleted or archived project takes no applications", async () => {
  await withProject(async ({ projectId, roleId }) => {
    await sql`UPDATE projects SET status = 'archived' WHERE id = ${projectId}`;
    const closed = await apps.applyToRoleAction(projectId, roleId, "hi");
    assert.equal(closed.success, false);
    assert.equal(closed.errorCode, "PROJECT_CLOSED");
    await sql`UPDATE projects SET status = 'active', deleted_at = now() WHERE id = ${projectId}`;
    const gone = await apps.applyToRoleAction(projectId, roleId, "hi");
    assert.equal(gone.success, false);
    assert.equal(gone.errorCode, "PROJECT_NOT_FOUND");
  });
});

test("input is validated: bad ids, empty and over-long messages; text is kept verbatim", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    assert.equal((await apps.applyToRoleAction(projectId, "not-a-uuid", "hi")).errorCode, "INVALID_INPUT");
    assert.equal((await apps.applyToRoleAction(projectId, roleId, "   ")).errorCode, "INVALID_INPUT");
    const tooLong = await apps.applyToRoleAction(projectId, roleId, "x".repeat(2001));
    assert.equal(tooLong.errorCode, "INVALID_INPUT");
    const text = "I build things.\nI build things.\n\n\n\nhttps://github.com/me";
    const ok = await apps.applyToRoleAction(projectId, roleId, text);
    assert.equal(ok.success, true, JSON.stringify(ok));
    assert.equal((await row(projectId, applicant))!.message, "I build things.\nI build things.\n\nhttps://github.com/me");
  });
});

test("when a role fills, other pending applicants are closed as role_filled, told in their thread, and notified", async () => {
  await withProject(async ({ owner, applicant, projectId, roleId }) => {
    const second = await sql.begin((tx) => createUser(tx));
    const winner = await apps.applyToRoleAction(projectId, roleId, "me first");
    viewerId = second;
    const loser = await apps.applyToRoleAction(projectId, roleId, "me too");
    await sql`UPDATE project_open_roles SET count = 1 WHERE id = ${roleId}`;
    viewerId = owner;
    assert.equal((await apps.acceptApplicationAction(winner.applicationId!)).success, true);
    const lost = await row(projectId, second);
    assert.equal(lost!.status, "rejected");
    assert.equal(lost!.decision_reason_code, "role_filled");
    const lines = await sql`SELECT m.body FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE c.application_id = ${loser.applicationId!} AND m.kind = 'system'`;
    assert.ok(lines.some((l) => /role was filled/i.test(String(l.body))), JSON.stringify(lines));
    const notes = await sql`SELECT 1 FROM user_notifications WHERE user_id = ${second} AND (entity_refs->>'applicationId') = ${loser.applicationId!}`;
    assert.ok(notes.length >= 1, "the closed applicant is notified");
    void applicant;
  });
});

test("details are stored beside the message, edits replace them, and the status carries what the card needs", async () => {
  await withProject(async ({ applicant, projectId, roleId }) => {
    const bad = await apps.applyToRoleAction(projectId, roleId, "hi", { details: { portfolioUrl: "javascript:alert(1)" } });
    assert.equal(bad.errorCode, "INVALID_INPUT");
    const first = await apps.applyToRoleAction(projectId, roleId, "cover letter", { details: { portfolioUrl: "https://github.com/me", availability: "10 hrs/week" } });
    assert.equal(first.success, true, JSON.stringify(first));
    const [stored] = await sql`SELECT message, details FROM role_applications WHERE id = ${first.applicationId!}`;
    assert.equal(stored!.message, "cover letter", "the message is the cover letter alone");
    assert.deepEqual(stored!.details, { portfolioUrl: "https://github.com/me", availability: "10 hrs/week" });

    const status = await apps.getApplicationStatusAction(projectId);
    assert.equal(status.status, "pending");
    assert.equal(status.message, "cover letter");
    assert.equal(status.applicationId, first.applicationId);
    assert.ok(status.channelId, "the thread id is returned");
    assert.ok(status.editableUntil && status.editableUntil.getTime() > Date.now(), "the edit window is open");

    const edited = await apps.editPendingApplicationAction(first.applicationId!, "cover letter, better", null, { details: { availability: "20 hrs/week" } });
    assert.equal(edited.success, true, JSON.stringify(edited));
    const [after] = await sql`SELECT message, details FROM role_applications WHERE id = ${first.applicationId!}`;
    assert.equal(after!.message, "cover letter, better");
    assert.deepEqual(after!.details, { availability: "20 hrs/week" }, "an edit replaces the details");

    await sql`UPDATE role_applications SET created_at = now() - interval '1 hour' WHERE id = ${first.applicationId!}`;
    assert.equal((await apps.getApplicationStatusAction(projectId)).editableUntil, undefined, "the window closes");
    void applicant;
  });
});

test("a profile's apply picker leaves out projects the viewer cannot apply to right now", async () => {
  // The picker reads the viewer from the request; here the viewer is whoever the test says it is.
  moduleStubs.set("@/lib/server/viewer-context", { getViewerAuthContext: async () => ({ userId: viewerId }) });
  const lifecycle = await loadAppModule(() => import("../../src/lib/projects/server/lifecycle"));
  await withProject(async ({ owner, projectId, roleId }) => {
    await sql`UPDATE projects SET open_roles_count = 1 WHERE id = ${projectId}`;
    const offered = async () => (await lifecycle.getProfileProjectsWithOpenRolesAction(owner)).items.some((item: { id: string }) => item.id === projectId);
    assert.equal(await offered(), true, "offered before applying");
    const first = await apps.applyToRoleAction(projectId, roleId, "hello");
    assert.equal(await offered(), false, "not offered while pending");
    assert.equal((await apps.withdrawApplicationAction(first.applicationId!)).success, true);
    assert.equal(await offered(), true, "offered again after withdrawing");
    await sql`UPDATE role_applications SET status = 'rejected', decision_at = now(), decision_by = ${owner}, decision_reason_code = 'other', updated_at = now() WHERE id = ${first.applicationId!}`;
    assert.equal(await offered(), false, "not offered inside the cooldown");
    await sql`UPDATE role_applications SET updated_at = now() - interval '25 hours' WHERE id = ${first.applicationId!}`;
    assert.equal(await offered(), true, "offered after the cooldown");
    await sql`UPDATE projects SET status = 'archived' WHERE id = ${projectId}`;
    assert.equal(await offered(), false, "not offered once archived");
    await sql`UPDATE projects SET status = 'active' WHERE id = ${projectId}`;
    assert.equal(await offered(), true);
    await sql`INSERT INTO project_invitations (project_id, inviter_id, candidate_id, kind, role_id, role_title, project_title, status, expires_at)
      VALUES (${projectId}, ${owner}, ${viewerId}, 'ordinary_role', ${roleId}, 'Designer', 'P', 'pending', now() + interval '1 day')`;
    assert.equal(await offered(), false, "not offered while an invitation to it is pending");
    assert.equal((await lifecycle.getProfileProjectsWithOpenRolesAction(owner)).capReached, false);
  });
});
