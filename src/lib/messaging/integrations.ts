import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { publishChannelActivity, publishUser } from "@/lib/messaging/publish";

// Hooks other domains call (projects, applications, invitations). Each takes
// an executor so it runs inside the caller's transaction.
type Executor = { execute: (query: SQL) => PromiseLike<unknown> };

async function value<T>(executor: Executor, query: SQL): Promise<T> {
  const rows = (await executor.execute(query)) as unknown as Array<{ value: T }>;
  return rows[0]?.value as T;
}

/** Keep chat membership in step with project membership (report 7.1, 7.9). */
export async function syncWorkspaceChat(
  executor: Executor,
  projectId: string,
  userId: string | null,
  op: "ensure_default" | "add" | "remove" | "role",
) {
  await executor.execute(sql`SELECT app_private.chat_sync_workspace_members(${projectId}::uuid, ${userId}::uuid, ${op})`);
  // Their sidebar picks up threads they just gained or lost. Best effort: outside a request there is nobody to tell.
  if (userId && op !== "ensure_default") tell(() => publishUser(userId, "membership.changed", {}));
}

/** Realtime is a courtesy after the data is written; it never fails the write (or a script with no request). */
function tell(publish: () => void) {
  try {
    publish();
  } catch {
    // no request scope
  }
}

/** The application's private thread (applicant + reviewers) opened by the application card. */
export async function ensureApplicationChannel(executor: Executor, applicationId: string) {
  return value<string>(executor, sql`SELECT app_private.chat_ensure_application_channel(${applicationId}::uuid) AS value`);
}

/**
 * A system line in an application thread, e.g. a status change: one database call finds (or opens) the thread and
 * posts. Open viewers and the other members are told after the write.
 */
export async function postApplicationUpdate(executor: Executor, applicationId: string, actorId: string, text: string) {
  const channelId = await value<string>(executor, sql`SELECT app_private.chat_post_application_update(${applicationId}::uuid, ${actorId}::uuid, ${text}) AS value`);
  tell(() => publishChannelActivity(channelId, actorId));
  return channelId;
}

/** The applicant's open project page re-reads its Open roles card as soon as a reviewer decides. */
export function announceApplicationChange(applicantId: string, projectId: string) {
  tell(() => publishUser(applicantId, "application.changed", { project_id: projectId }));
}

/** A brand-new application thread: its members learn of it now, not at the next poll. */
export function announceApplicationChannel(channelId: string, actorId: string) {
  tell(() => publishChannelActivity(channelId, actorId));
}

/**
 * Post a lean Slack-style Member Joined notice to the project's default channel (#general).
 * Notifies active viewers via Realtime.
 */
export async function postMemberJoined(
  executor: Executor,
  projectId: string,
  userId: string,
) {
  const channelId = await value<string | null>(
    executor,
    sql`SELECT app_private.chat_post_member_joined(${projectId}::uuid, ${userId}::uuid) AS value`,
  );
  if (channelId) {
    tell(() => publishChannelActivity(channelId, userId));
  }
  return channelId;
}

/**
 * Post an invitation card into the inviter↔candidate DM. Invitations may open a
 * DM regardless of message privacy (never across a block).
 */
export async function postInviteCard(input: {
  invitationId: string;
  inviterId: string;
  candidateId: string;
  note: string | null;
}) {
  const channelId = await value<string>(db, sql`
    SELECT app_private.chat_get_or_create_dm(${input.inviterId}::uuid, ${input.candidateId}::uuid, 'invite') AS value
  `);
  const body = (input.note ?? "").slice(0, 4000);
  const card = { kind: "invite" as const, ref_id: input.invitationId };
  const { sendAs } = await import("@/lib/messaging/send");
  const result = await sendAs({ id: input.inviterId }, { channelId, body, clientId: `invite:${input.invitationId}` }, card);
  if (!result.success) throw new Error(result.error);
  return channelId;
}
