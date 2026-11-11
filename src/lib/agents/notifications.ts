/**
 * An agent session's notifications go out as one summary (report A11.6): while an agent works they're held, and
 * sent together 15 minutes after its last change (an Inngest function debounced per session) or when the session
 * ends (`POST /api/v1/agent-sessions/end`, called by `nb mcp` when the agent disconnects). Questions, finished-task
 * reports and anything asking someone to review still go at once.
 */
import { asc, eq, inArray } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { agentNotificationBuffer, extensionDeviceSessions, profiles } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { NotificationFanoutWrite } from "@/lib/notifications/types";
import { requestVia } from "@/lib/server/request-via";

export const SUMMARY_SOURCE = "agent-session-summary";
const SENT_AT_ONCE = new Set(["agent_question", "agent_access_request", "task_report_submitted", "task_status_attention", "task_file_needs_review", "trust_safety", "project_security_alert"]);

/** Keeps the writes that should wait for the session summary; returns the ones to send now. */
export async function holdAgentWrites(writes: NotificationFanoutWrite[], source?: string | null): Promise<NotificationFanoutWrite[]> {
  if (source === SUMMARY_SOURCE) return writes;
  const via = await requestVia();
  if (via?.via !== "agent" || !via.sessionId) return writes;
  const held = writes.filter((w) => !SENT_AT_ONCE.has(w.input.kind));
  if (!held.length) return writes;
  await db.insert(agentNotificationBuffer).values(held.map((w) => ({ sessionId: via.sessionId!, recipientUserId: w.input.recipientUserId, write: w as unknown as Record<string, unknown> })));
  await inngest.send({ name: "agent/notifications.held", data: { sessionId: via.sessionId } }).catch((error: unknown) =>
    logger.warn("agents.notifications.held_event_failed", { module: "agents", error: error instanceof Error ? error.message : String(error) }),
  );
  return writes.filter((w) => SENT_AT_ONCE.has(w.input.kind));
}

/** Sends one summary per recipient for everything held from this session, and clears it. */
export async function flushAgentSession(sessionId: string) {
  const rows = await db.transaction(async (tx) => {
    const taken = await tx.select().from(agentNotificationBuffer).where(eq(agentNotificationBuffer.sessionId, sessionId)).orderBy(asc(agentNotificationBuffer.createdAt)).for("update", { skipLocked: true });
    if (taken.length) await tx.delete(agentNotificationBuffer).where(inArray(agentNotificationBuffer.id, taken.map((r) => r.id)));
    return taken;
  });
  if (!rows.length) return { sent: 0 };
  const [session] = await db.select({ agentName: extensionDeviceSessions.agentName, userId: extensionDeviceSessions.userId }).from(extensionDeviceSessions).where(eq(extensionDeviceSessions.id, sessionId)).limit(1);
  const [owner] = session ? await db.select({ name: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, session.userId)).limit(1) : [];
  const who = `${session?.agentName ?? "An AI agent"}${owner ? ` (for ${owner.name ?? owner.username ?? "someone"})` : ""}`;

  const byRecipient = new Map<string, NotificationFanoutWrite[]>();
  for (const row of rows) {
    const list = byRecipient.get(row.recipientUserId) ?? [];
    list.push(row.write as unknown as NotificationFanoutWrite);
    byRecipient.set(row.recipientUserId, list);
  }
  const writes: NotificationFanoutWrite[] = [...byRecipient.entries()].map(([recipientUserId, items]) => {
    const titles = [...new Set(items.map((w) => w.input.title))];
    const first = items[0]!.input;
    return {
      operation: "create",
      input: {
        recipientUserId,
        actorUserId: session?.userId ?? first.actorUserId ?? null,
        kind: "agent_session_summary",
        category: first.category,
        title: `${who} made ${items.length} change${items.length === 1 ? "" : "s"}`,
        body: titles.slice(0, 4).join(" · ") + (titles.length > 4 ? ` · and ${titles.length - 4} more` : ""),
        href: first.href ?? null,
        entityRefs: first.entityRefs ?? null,
        dedupeKey: `agent-session:${sessionId}:${recipientUserId}:${rows[0]!.id}`,
      },
    };
  });
  const { enqueueNotificationFanout } = await import("@/lib/notifications/fanout");
  await enqueueNotificationFanout({ writes, source: SUMMARY_SOURCE });
  return { sent: writes.length };
}
