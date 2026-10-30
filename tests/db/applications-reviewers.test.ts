import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId, user_metadata: {} } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
stubNextAfter();

let apps: typeof import("../../src/app/actions/applications");
let invitations: typeof import("../../src/app/actions/network-invitations");
let workspace: typeof import("../../src/app/actions/my-work");
before(async () => {
  apps = await loadAppModule(() => import("../../src/app/actions/applications"));
  invitations = await loadAppModule(() => import("../../src/app/actions/network-invitations"));
  workspace = await loadAppModule(() => import("../../src/app/actions/my-work"));
});
after(async () => { await sql.end(); await closeAppDb(); });

type Ctx = { owner: string; admin: string; member: string; applicant: string; projectId: string; roleId: string; applicationId: string; channelId: string };

async function withApplication(fn: (ctx: Ctx) => Promise<void>) {
  const [owner, admin, member, applicant] = await Promise.all([0, 1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const projectId = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => {
    await addMember(tx, projectId, owner!, "owner");
    await addMember(tx, projectId, admin!, "admin");
    await addMember(tx, projectId, member!, "member");
  });
  const [role] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, count) VALUES (${projectId}, 'Designer', 3) RETURNING id`;
  try {
    viewerId = applicant!;
    const applied = await apps.applyToRoleAction(projectId, role!.id as string, "I would like to help");
    assert.equal(applied.success, true, JSON.stringify(applied));
    const [channel] = await sql`SELECT id FROM chat_channels WHERE application_id = ${applied.applicationId!}`;
    await fn({
      owner: owner!, admin: admin!, member: member!, applicant: applicant!, projectId,
      roleId: role!.id as string, applicationId: applied.applicationId!, channelId: channel!.id as string,
    });
  } finally {
    await sql`DELETE FROM role_applications WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM chat_channels WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspace_open_roles WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspaces WHERE id = ${projectId}`;
  }
}

const inThread = async (channelId: string, userId: string) =>
  (await sql`SELECT 1 FROM chat_channel_members WHERE channel_id = ${channelId} AND user_id = ${userId}`).length === 1;
const sync = (projectId: string, userId: string, op: string) =>
  sql`SELECT app_private.chat_sync_workspace_members(${projectId}::uuid, ${userId}::uuid, ${op})`;
const queue = async (userId: string) => {
  viewerId = userId;
  const result = await invitations.readNetworkInvitationsAction({ direction: "received", kind: "projects" });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.items.filter((item) => item.source === "application").length : -1;
};

test("the review queue follows project membership, not the owner at apply time", async () => {
  await withApplication(async ({ owner, admin, member, projectId }) => {
    assert.equal(await queue(owner), 1);
    assert.equal(await queue(admin), 1, "an admin sees the queue");
    assert.equal(await queue(member), 0, "a plain member does not");
    const requestCount = async (userId: string) => {
      viewerId = userId;
      const summary = await workspace.getMyWorkSummaryAction();
      return summary.success ? summary.requestCount : -1;
    };
    assert.equal(await requestCount(admin), 1);
    assert.equal(await requestCount(member), 0);
    // Ownership moves to the admin; the old owner stays on as admin.
    await sql`UPDATE workspaces SET owner_id = ${admin} WHERE id = ${projectId}`;
    await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${projectId} AND user_id = ${owner}`;
    await sql`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ${projectId} AND user_id = ${admin}`;
    assert.equal(await queue(admin), 1, "the new owner holds the queue");
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId} AND user_id = ${owner}`;
    assert.equal(await queue(owner), 0, "a removed owner no longer sees it");
  });
});

test("thread membership follows reviewer changes; the applicant keeps their thread", async () => {
  await withApplication(async ({ owner, admin, member, applicant, projectId, channelId }) => {
    assert.ok(await inThread(channelId, owner) && await inThread(channelId, admin) && await inThread(channelId, applicant));
    assert.equal(await inThread(channelId, member), false, "a plain member is not a reviewer");

    await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${projectId} AND user_id = ${member}`;
    await sync(projectId, member, "role");
    assert.equal(await inThread(channelId, member), true, "a promoted admin joins");

    await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${projectId} AND user_id = ${admin}`;
    await sync(projectId, admin, "role");
    assert.equal(await inThread(channelId, admin), false, "a demoted admin loses the thread");

    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId} AND user_id = ${member}`;
    await sync(projectId, member, "remove");
    assert.equal(await inThread(channelId, member), false, "a removed admin leaves");

    await addMember(sql as never, projectId, applicant, "member");
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId} AND user_id = ${applicant}`;
    await sync(projectId, applicant, "remove");
    assert.equal(await inThread(channelId, applicant), true, "removing the applicant from the workspace keeps their own thread");

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM chat_channel_members WHERE channel_id = ${channelId}`;
    const [{ member_count }] = await sql`SELECT member_count FROM chat_channels WHERE id = ${channelId}`;
    assert.equal(member_count, count, "member_count stays exact");
  });
});

test("an application thread has a fixed cast: nobody is added or removed by hand", async () => {
  await withApplication(async ({ owner, member, applicant, channelId }) => {
    await assert.rejects(sql`SELECT app_private.chat_add_members(${channelId}::uuid, ${owner}::uuid, ${[member]}::uuid[])`, /chat_application_members_fixed/);
    await assert.rejects(sql`SELECT app_private.chat_remove_member(${channelId}::uuid, ${owner}::uuid, ${applicant}::uuid)`, /chat_application_members_fixed/);
    assert.equal(await inThread(channelId, applicant), true);
  });
});

test("the application card cannot be deleted, and is put back if it ever goes missing", async () => {
  await withApplication(async ({ applicant, applicationId, channelId }) => {
    const [card] = await sql`SELECT message_seq FROM chat_message_cards WHERE channel_id = ${channelId} AND kind = 'application'`;
    assert.ok(card, "the thread opens with a card");
    await assert.rejects(sql`SELECT app_private.chat_delete_message(${channelId}::uuid, ${card!.message_seq}::bigint, ${applicant}::uuid)`, /chat_not_deletable/);
    await sql`DELETE FROM chat_message_cards WHERE channel_id = ${channelId}`;
    await sql`SELECT app_private.chat_ensure_application_channel(${applicationId}::uuid)`;
    const cards = await sql`SELECT 1 FROM chat_message_cards WHERE channel_id = ${channelId} AND kind = 'application' AND ref_id = ${applicationId}`;
    assert.equal(cards.length, 1, "ensure re-attaches the card");
  });
});

test("a second rejection after a reopen notifies again", async () => {
  await withApplication(async ({ owner, applicant, applicationId }) => {
    const decisions = async () => (await sql`SELECT 1 FROM user_notifications WHERE user_id = ${applicant} AND (entity_refs->>'applicationId') = ${applicationId}`).length;
    viewerId = owner;
    assert.equal((await apps.rejectApplicationAction(applicationId, undefined, "other")).success, true);
    const afterFirst = await decisions();
    assert.equal((await apps.reopenApplicationAction(applicationId)).success, true);
    assert.equal((await apps.rejectApplicationAction(applicationId, undefined, "other")).success, true);
    assert.ok((await decisions()) >= afterFirst + 2, "reopen and the second rejection each notify");
  });
});

test("the table refuses states the lifecycle never produces", async () => {
  await withApplication(async ({ applicationId }) => {
    const bad = (query: Promise<unknown>, name: RegExp) => assert.rejects(query, name);
    await bad(sql`UPDATE role_applications SET decision_reason_code = 'because' WHERE id = ${applicationId}`, /role_applications_reason_code_check/);
    await bad(sql`UPDATE role_applications SET status = 'accepted', decision_at = NULL WHERE id = ${applicationId}`, /role_applications_accepted_decided_check/);
    await bad(sql`UPDATE role_applications SET message = ${"x".repeat(2001)} WHERE id = ${applicationId}`, /role_applications_message_length_check/);
    await bad(sql`UPDATE role_applications SET details = '[]'::jsonb WHERE id = ${applicationId}`, /role_applications_details_object_check/);
    const [row] = await sql`SELECT details FROM role_applications WHERE id = ${applicationId}`;
    assert.deepEqual(row!.details, {}, "details starts empty");
  });
});

test("the applicant sees their own applications under Sent, with status, reason and thread", async () => {
  await withApplication(async ({ owner, applicant, applicationId, channelId }) => {
    const sent = async () => {
      viewerId = applicant;
      const result = await invitations.readNetworkInvitationsAction({ direction: "sent", kind: "projects" });
      assert.equal(result.success, true, JSON.stringify(result));
      return result.success ? result.items.filter((item) => item.source === "application") : [];
    };
    const [pending] = await sent();
    assert.equal(pending?.id, applicationId);
    assert.equal(pending?.applicationStatus, "pending");
    assert.equal(pending?.channelId, channelId);
    assert.equal(pending?.person.id, owner, "the other party is the workspace owner");
    viewerId = owner;
    assert.equal((await apps.rejectApplicationAction(applicationId, undefined, "availability")).success, true);
    const [declined] = await sent();
    assert.equal(declined?.applicationStatus, "rejected");
    assert.match(declined?.decisionReason ?? "", /availability/i);
    assert.equal((await queue(owner)), 0, "a decided application leaves the reviewer's queue");
    await sql`UPDATE role_applications SET updated_at = now() - interval '31 days' WHERE id = ${applicationId}`;
    assert.equal((await sent()).length, 0, "old decisions drop off");
  });
});

test("reviewers get a Decided list with reasons and the details the applicant filled in", async () => {
  await withApplication(async ({ owner, admin, applicant, applicationId }) => {
    await sql`UPDATE role_applications SET details = ${sql.json({ portfolioUrl: "https://github.com/me" })} WHERE id = ${applicationId}`;
    const pendingRow = async (viewer: string) => {
      viewerId = viewer;
      const result = await invitations.readNetworkInvitationsAction({ direction: "received", kind: "projects" });
      return result.success ? result.items.find((item) => item.id === applicationId) : undefined;
    };
    assert.deepEqual((await pendingRow(admin))?.details, { portfolioUrl: "https://github.com/me" }, "the review dialog gets the details");
    assert.ok((await pendingRow(admin))?.channelId, "and the thread to open");

    const decided = async (viewer: string) => {
      viewerId = viewer;
      const result = await invitations.readNetworkInvitationsAction({ kind: "decided" });
      assert.equal(result.success, true, JSON.stringify(result));
      return result.success ? result.items : [];
    };
    assert.equal((await decided(admin)).length, 0, "nothing decided yet");
    viewerId = owner;
    assert.equal((await apps.rejectApplicationAction(applicationId, undefined, "skills_mismatch")).success, true);
    const [row] = await decided(admin);
    assert.equal(row?.applicationStatus, "rejected");
    assert.equal(row?.decisionCode, "skills_mismatch");
    assert.match(row?.decisionReason ?? "", /stack match/i);
    assert.equal((await pendingRow(admin)), undefined, "it left the open queue");
    assert.equal((await decided(applicant)).length, 0, "the applicant is not a reviewer of it");
  });
});

test("per-role counts are for reviewers only, and accepting several reports each one", async () => {
  await withApplication(async ({ owner, member, applicant, projectId, roleId, applicationId }) => {
    viewerId = owner;
    const counts = await apps.getRoleApplicationCountsAction(projectId);
    assert.deepEqual(counts.counts[roleId], { pending: 1, accepted: 0 });
    viewerId = member;
    assert.deepEqual((await apps.getRoleApplicationCountsAction(projectId)).counts, {}, "a plain member sees nothing");

    // One seat, two applicants: the first accept fills it, the second can no longer be accepted.
    await sql`UPDATE workspace_open_roles SET count = 1 WHERE id = ${roleId}`;
    const second = await sql.begin((tx) => createUser(tx));
    viewerId = second;
    const other = await apps.applyToRoleAction(projectId, roleId, "me too");
    assert.equal(other.success, true, JSON.stringify(other));
    viewerId = owner;
    const outcome = await apps.acceptApplicationsAction([applicationId, other.applicationId!]);
    assert.equal(outcome.results.length, 2);
    assert.equal(outcome.results.filter((r) => r.success).length, 1, JSON.stringify(outcome));
    assert.ok(outcome.results.find((r) => !r.success)?.error, "the one that failed says why");
    assert.equal((await apps.acceptApplicationsAction([])).success, false);
    void applicant;
  });
});

test("Your applications keeps a withdrawn application for a while and says why a decline happened", async () => {
  await withApplication(async ({ applicant, applicationId }) => {
    viewerId = applicant;
    assert.equal((await apps.withdrawApplicationAction(applicationId)).success, true);
    const result = await invitations.readNetworkInvitationsAction({ direction: "sent", kind: "projects" });
    assert.equal(result.success, true, JSON.stringify(result));
    const item = result.success ? result.items.find((entry) => entry.id === applicationId) : undefined;
    assert.equal(item?.applicationStatus, "withdrawn");
    await sql`UPDATE role_applications SET status = 'rejected', decision_reason_code = 'role_filled', decision_at = now() WHERE id = ${applicationId}`;
    const again = await invitations.readNetworkInvitationsAction({ direction: "sent", kind: "projects" });
    const filled = again.success ? again.items.find((entry) => entry.id === applicationId) : undefined;
    assert.equal(filled?.decisionCode, "role_filled", "the sent list carries the code so it can read 'Role filled'");
  });
});

test("every badge agrees with its list: deleted and blocked applicants are in neither; the Workspace rows carry their thread", async () => {
  const { countReviewableApplications } = await loadAppModule(() => import("../../src/lib/applications/reviewers"));
  await withApplication(async ({ owner, applicant, applicationId, channelId }) => {
    assert.equal(await countReviewableApplications(owner), 1);
    viewerId = owner;
    const incoming = await apps.getIncomingApplicationsAction({ limit: 20 });
    assert.equal(incoming.success, true, JSON.stringify(incoming));
    const row = incoming.success ? incoming.applications.find((item: { id: string }) => item.id === applicationId) : undefined;
    assert.equal((row as { channelId?: string } | undefined)?.channelId, channelId, "the row can open its thread");

    await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${owner}, ${applicant})`;
    assert.equal(await countReviewableApplications(owner), 0, "a blocked applicant is not counted");
    assert.equal(await queue(owner), 0, "nor listed");
    await sql`DELETE FROM user_blocks WHERE blocker_id = ${owner} AND blocked_id = ${applicant}`;
    await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${applicant}`;
    assert.equal(await countReviewableApplications(owner), 0, "a deleted account is not counted");
    await sql`UPDATE profiles SET deleted_at = NULL WHERE id = ${applicant}`;
    assert.equal(await countReviewableApplications(owner), 1);
  });
});

test("the review dialog's fit comes only for someone who can review the application", async () => {
  await withApplication(async ({ owner, member, applicationId }) => {
    viewerId = owner;
    const fit = await apps.getApplicationAlignmentAction(applicationId);
    assert.ok(fit && "skillsMatch" in fit, JSON.stringify(fit));
    viewerId = member;
    assert.equal(await apps.getApplicationAlignmentAction(applicationId), null, "a plain member gets nothing");
  });
});
