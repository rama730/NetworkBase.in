import "server-only";

import { and, count, desc, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentAccessRequests, extensionDeviceSessions } from "@/lib/db/schema";
import { enqueueNotificationFanout } from "@/lib/notifications/fanout";

/**
 * An agent asking for a permission it lacks (report A5 "Asking for more", A10). The request lands in the person's
 * inbox; they answer Allow once, Always or No. "Once" covers one request with the same method and path within an
 * hour (the token check runs before any body is read, so the body can't be part of the match).
 */
export const OPEN_REQUEST_LIMIT = 3;
const REQUEST_TTL_MS = 24 * 60 * 60_000;
const ONCE_WINDOW_MS = 60 * 60_000;
const NO_QUIET_MS = 24 * 60 * 60_000;

const SCOPE_WORDS: Record<string, string> = {
  "task:complete": "finish tasks",
  "file:final": "change final files",
  "doc:write": "edit docs",
  "task:review": "approve or return reviews",
};

export type AccessAsk = { requestId: string; scope: string } | { blocked: "limit" | "said_no"; retryAfterSeconds?: number };

export async function requestAccess(input: { sessionId: string; userId: string; scope: string; method: string; path: string; agentName: string | null; reason?: string | null }, now = new Date()): Promise<AccessAsk> {
  const path = input.path.split("?")[0]!.slice(0, 500);
  const outcome = await db.transaction(async (tx): Promise<AccessAsk & { created?: boolean }> => {
    // Lock the sign-in so two requests at once can't both pass the limit or both make a row.
    await tx.execute(sql`SELECT id FROM extension_device_sessions WHERE id = ${input.sessionId} FOR UPDATE`);
    await tx.update(agentAccessRequests).set({ status: "expired" }).where(and(eq(agentAccessRequests.sessionId, input.sessionId), eq(agentAccessRequests.status, "open"), lte(agentAccessRequests.expiresAt, now)));
    const [saidNo] = await tx.select({ decidedAt: agentAccessRequests.decidedAt }).from(agentAccessRequests)
      .where(and(eq(agentAccessRequests.sessionId, input.sessionId), eq(agentAccessRequests.scope, input.scope), eq(agentAccessRequests.status, "no"), gt(agentAccessRequests.decidedAt, new Date(now.getTime() - NO_QUIET_MS))))
      .orderBy(desc(agentAccessRequests.decidedAt)).limit(1);
    if (saidNo?.decidedAt) return { blocked: "said_no", retryAfterSeconds: Math.ceil((saidNo.decidedAt.getTime() + NO_QUIET_MS - now.getTime()) / 1000) };
    const [same] = await tx.select({ id: agentAccessRequests.id }).from(agentAccessRequests)
      .where(and(eq(agentAccessRequests.sessionId, input.sessionId), eq(agentAccessRequests.scope, input.scope), eq(agentAccessRequests.status, "open")))
      .limit(1);
    if (same) return { requestId: same.id, scope: input.scope };
    const [{ open } = { open: 0 }] = await tx.select({ open: count() }).from(agentAccessRequests).where(and(eq(agentAccessRequests.sessionId, input.sessionId), eq(agentAccessRequests.status, "open")));
    if (open >= OPEN_REQUEST_LIMIT) return { blocked: "limit" };
    const [created] = await tx.insert(agentAccessRequests).values({
      sessionId: input.sessionId, userId: input.userId, scope: input.scope, method: input.method.toUpperCase(), path,
      reason: input.reason?.slice(0, 300) ?? null, expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
    }).returning({ id: agentAccessRequests.id });
    return { requestId: created!.id, scope: input.scope, created: true };
  });
  if (!("requestId" in outcome) || !outcome.created) return outcome;
  const agent = input.agentName?.trim() || "An AI agent";
  await enqueueNotificationFanout({
    source: "agent-access-request",
    writes: [{
      operation: "create",
      input: {
        // The person's own agent is asking, so there is no other actor.
        recipientUserId: input.userId, actorUserId: null, kind: "agent_access_request", category: "workflows", importance: "important",
        title: `${agent} asks to also ${SCOPE_WORDS[input.scope] ?? input.scope}`.slice(0, 200),
        body: "Allow once, always, or say no.",
        href: `/settings/agents/${input.sessionId}?request=${outcome.requestId}`,
        entityRefs: {},
        dedupeKey: `agent-access-request:${outcome.requestId}`,
      },
    }],
  });
  return { requestId: outcome.requestId, scope: input.scope };
}

/** Uses an "Allow once" answer for this exact method and path; true when it was there and is now spent. */
export async function consumeOnceGrant(input: { sessionId: string; scope: string; method: string; path: string; requestId: string }, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) return false;
  const used = await db.update(agentAccessRequests).set({ status: "used", usedAt: now })
    .where(and(
      eq(agentAccessRequests.id, input.requestId), eq(agentAccessRequests.sessionId, input.sessionId), eq(agentAccessRequests.scope, input.scope),
      eq(agentAccessRequests.method, input.method.toUpperCase()), eq(agentAccessRequests.path, input.path.split("?")[0]!.slice(0, 500)),
      eq(agentAccessRequests.status, "once"), gt(agentAccessRequests.decidedAt, new Date(now.getTime() - ONCE_WINDOW_MS)),
    ))
    .returning({ id: agentAccessRequests.id });
  return used.length === 1;
}

/** The person's answer. Only the person the request belongs to can answer, and only while it's open. */
export async function decideAgentAccessRequest(userId: string, requestId: string, answer: "once" | "always" | "no", now = new Date()) {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(agentAccessRequests)
      .where(and(eq(agentAccessRequests.id, requestId), eq(agentAccessRequests.userId, userId), eq(agentAccessRequests.status, "open"), gt(agentAccessRequests.expiresAt, now)))
      .limit(1).for("update");
    if (!request) throw new Error("This request was not found, or was already answered");
    await tx.update(agentAccessRequests).set({ status: answer, decidedAt: now }).where(eq(agentAccessRequests.id, requestId));
    if (answer === "always") {
      const [session] = await tx.select({ scopes: extensionDeviceSessions.scopes }).from(extensionDeviceSessions).where(eq(extensionDeviceSessions.id, request.sessionId)).limit(1).for("update");
      const scopes = new Set<string>((session?.scopes as string[] | null) ?? []);
      scopes.add(request.scope);
      await tx.update(extensionDeviceSessions).set({ scopes: [...scopes] }).where(eq(extensionDeviceSessions.id, request.sessionId));
      // Any other open ask for the same permission is answered by this.
      await tx.update(agentAccessRequests).set({ status: "always", decidedAt: now })
        .where(and(eq(agentAccessRequests.sessionId, request.sessionId), eq(agentAccessRequests.scope, request.scope), eq(agentAccessRequests.status, "open")));
    }
    return { sessionId: request.sessionId, scope: request.scope, answer };
  });
}

/** Open requests for one sign-in, newest first, for its Settings page (report A6 #3). */
export async function openAccessRequests(userId: string, sessionId: string, now = new Date()) {
  return db.select({ id: agentAccessRequests.id, scope: agentAccessRequests.scope, method: agentAccessRequests.method, path: agentAccessRequests.path, reason: agentAccessRequests.reason, createdAt: agentAccessRequests.createdAt, expiresAt: agentAccessRequests.expiresAt })
    .from(agentAccessRequests)
    .where(and(eq(agentAccessRequests.userId, userId), eq(agentAccessRequests.sessionId, sessionId), eq(agentAccessRequests.status, "open"), gt(agentAccessRequests.expiresAt, now)))
    .orderBy(desc(agentAccessRequests.createdAt));
}

export const accessRequestWords = (scope: string) => SCOPE_WORDS[scope] ?? scope;
