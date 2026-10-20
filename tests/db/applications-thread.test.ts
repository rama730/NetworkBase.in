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
before(async () => { apps = await loadAppModule(() => import("../../src/app/actions/applications")); });
after(async () => { await sql.end(); await closeAppDb(); });

async function withThread(fn: (ctx: { owner: string; admin: string; applicant: string; applicationId: string; channelId: string }) => Promise<void>) {
  const [owner, admin, applicant] = await Promise.all([0, 1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const projectId = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => { await addMember(tx, projectId, owner!, "owner"); await addMember(tx, projectId, admin!, "admin"); });
  const [role] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${projectId}, 'Designer', 3) RETURNING id`;
  try {
    viewerId = applicant!;
    const applied = await apps.applyToRoleAction(projectId, role!.id as string, "I would like to help");
    assert.equal(applied.success, true, JSON.stringify(applied));
    const [channel] = await sql`SELECT id FROM chat_channels WHERE application_id = ${applied.applicationId!}`;
    await fn({ owner: owner!, admin: admin!, applicant: applicant!, applicationId: applied.applicationId!, channelId: channel!.id as string });
  } finally {
    await sql`DELETE FROM role_applications WHERE project_id = ${projectId}`;
    await sql`DELETE FROM chat_channels WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_open_roles WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

const send = (channelId: string, author: string, body: string) =>
  sql`SELECT app_private.chat_send_message(${channelId}::uuid, ${author}::uuid, ${body}) AS value`;

test("a reply in an application thread notifies the other side", async () => {
  await withThread(async ({ owner, admin, applicant, channelId }) => {
    const [{ value }] = await send(channelId, owner, "Thanks for applying, can you share a repo?");
    const notify = value.notify as string[];
    assert.ok(notify.includes(applicant) && notify.includes(admin), JSON.stringify(notify));
    assert.ok(!notify.includes(owner), "never the author");
  });
});

test("a decision line is unread news with a preview, not silent", async () => {
  await withThread(async ({ owner, applicant, applicationId, channelId }) => {
    const [before] = await sql`SELECT last_top_seq, last_preview FROM chat_channels WHERE id = ${channelId}`;
    await sql`SELECT app_private.chat_post_system(${channelId}::uuid, ${owner}::uuid, 'declined this application')`;
    const [after] = await sql`SELECT last_top_seq, last_preview, last_author_id FROM chat_channels WHERE id = ${channelId}`;
    assert.ok(Number(after!.last_top_seq) > Number(before!.last_top_seq), "the line counts as top-level, so unread");
    assert.equal(after!.last_preview, "declined this application");
    const [member] = await sql`SELECT last_read_seq FROM chat_channel_members WHERE channel_id = ${channelId} AND user_id = ${applicant}`;
    assert.ok(Number(member!.last_read_seq) < Number(after!.last_top_seq), "the applicant has it unread");
    void applicationId;
  });
});

test("a block between two people in the thread stops posting for both", async () => {
  await withThread(async ({ owner, admin, applicant, channelId }) => {
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${applicant}, ${admin}, 'blocked', ${applicant}, now())`;
    try {
      await assert.rejects(send(channelId, applicant, "hello?"), /chat_blocked/);
      await assert.rejects(send(channelId, admin, "hello"), /chat_blocked/);
      await send(channelId, owner, "the owner is not blocked with the applicant, but is with nobody here");
    } finally {
      await sql`DELETE FROM connections WHERE requester_id = ${applicant} AND addressee_id = ${admin}`;
    }
  });
});

test("the card follows edits, not just status", async () => {
  const [{ def }] = await sql`SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'chat_card_changed_application'`;
  assert.match(String(def), /UPDATE OF status, message, role_id, details/);
});

test("every status change leaves a line that says who did what, and the card reads the whole story", async () => {
  const { hydrateCards } = await loadAppModule(() => import("../../src/lib/messaging/cards"));
  const { withApplicationMeta } = await loadAppModule(() => import("../../src/lib/messaging/application-meta"));
  await withThread(async ({ owner, applicant, applicationId, channelId }) => {
    await sql`UPDATE role_applications SET details = ${sql.json({ portfolioUrl: "https://github.com/me", availability: "10 hrs/week" })} WHERE id = ${applicationId}`;
    viewerId = owner;
    assert.equal((await apps.rejectApplicationAction(applicationId, "not this time", "availability")).success, true);
    const lines = await sql`SELECT body FROM chat_messages WHERE channel_id = ${channelId} AND kind = 'system' ORDER BY channel_seq`;
    assert.ok(lines.some((l) => l.body === "declined this application: not this time"), JSON.stringify(lines));
    assert.equal((await apps.reopenApplicationAction(applicationId)).success, true);
    const afterReopen = await sql`SELECT body FROM chat_messages WHERE channel_id = ${channelId} AND kind = 'system' ORDER BY channel_seq DESC LIMIT 1`;
    assert.equal(afterReopen[0]!.body, "reopened this application");

    assert.equal((await apps.rejectApplicationAction(applicationId, undefined, "experience")).success, true);
    const cards = await hydrateCards(owner, [{ kind: "application", ref_id: applicationId }]);
    const card = cards[`application:${applicationId}`] as unknown as Record<string, unknown>;
    assert.equal(card.status, "rejected");
    assert.equal(card.role_title, "Designer");
    assert.equal(card.role_removed, false);
    assert.deepEqual(card.details, { portfolioUrl: "https://github.com/me", availability: "10 hrs/week" });
    assert.equal(card.decision_reason_code, "experience");
    assert.equal((card.decided_by as { id: string }).id, owner);
    assert.ok(card.decision_reason_text);

    await sql`UPDATE role_applications SET role_id = NULL WHERE id = ${applicationId}`;
    const gone = (await hydrateCards(owner, [{ kind: "application", ref_id: applicationId }]))[`application:${applicationId}`] as unknown as Record<string, unknown>;
    assert.equal(gone.role_removed, true, "a deleted role is flagged, not shown as an empty name");

    const [summary] = await withApplicationMeta([{ application_id: applicationId }], applicant);
    assert.equal(summary!.application?.is_applicant, true);
    assert.equal(summary!.application?.status, "rejected");
    assert.equal(summary!.application?.role_removed, true);
  });
});

test("a status line is one call that opens a missing thread, and old threads get their card back", async () => {
  await withThread(async ({ owner, applicationId, channelId }) => {
    const [{ id }] = await sql`SELECT app_private.chat_post_application_update(${applicationId}::uuid, ${owner}::uuid, 'looking at this now') AS id`;
    assert.equal(id, channelId, "it posts into the existing thread");
    const [line] = await sql`SELECT body FROM chat_messages WHERE channel_id = ${channelId} AND kind = 'system' ORDER BY channel_seq DESC LIMIT 1`;
    assert.equal(line!.body, "looking at this now");
    const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'role_applications' AND indexname IN ('role_applications_project_id_idx', 'role_applications_applicant_id_idx', 'role_applications_role_id_idx')`;
    assert.equal(indexes.length, 0, "the prefix-duplicate indexes are gone");
  });
});
