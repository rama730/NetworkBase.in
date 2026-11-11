import "server-only";

import { and, eq, gt, isNull, lte } from "drizzle-orm";

import { accessRequestWords, openAccessRequests } from "@/lib/agents/access-requests";
import { describeAgentAccess, presetOf, scopesForPreset, type AgentPreset } from "@/lib/agents/access";
import { workspaceAgentPolicy } from "@/lib/agents/policy";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { extensionDeviceSessions, workspaces } from "@/lib/db/schema";
import { enqueueNotificationFanout } from "@/lib/notifications/fanout";
import { effectiveScopes, type TokenScope } from "@/lib/security/token-access";

/**
 * An agent sign-in after approval (report A4 "Afterwards", A5 "Changing access in place", "Renewal notice", A8).
 * Callers check the person's fresh sign-in (step-up) first; these only check ownership and the workspace.
 */
const DAY_MS = 86_400_000;
export type AgentAccessChoice = { access: AgentPreset; workspace: "all" | string; expiryDays?: 7 | 30 | 90; extraScopes?: TokenScope[] };

/** Why this person can't tie an agent to this workspace with this access, or null. Shared with /device. */
export async function agentWorkspaceProblem(userId: string, access: AgentPreset, workspace: "all" | string) {
  // "All my workspaces" is checked on every request instead (report A5).
  if (workspace === "all") return null;
  const can = await getWorkspaceAccessById(workspace, userId);
  if (access === "read" ? !can.canRead : !can.canWrite) {
    return access === "read" ? "Choose a workspace you can see" : "You can only read this workspace. Choose Read only, or another workspace.";
  }
  // An organization that turned agent tokens off (report A8.8).
  const org = await workspaceAgentPolicy(workspace);
  return org.orgAllowsAgents ? null : `${org.orgTitle ?? "This organization"} doesn't allow AI agents. Choose another workspace.`;
}

async function ownAgent(userId: string, sessionId: string, now: Date) {
  const [row] = await db.select().from(extensionDeviceSessions).where(and(
    eq(extensionDeviceSessions.id, sessionId), eq(extensionDeviceSessions.userId, userId), eq(extensionDeviceSessions.tokenType, "agent"),
    isNull(extensionDeviceSessions.revokedAt), gt(extensionDeviceSessions.expiresAt, now),
  )).limit(1);
  return row ?? null;
}

async function titleOf(workspaceId: string | null) {
  if (!workspaceId) return null;
  const [w] = await db.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return w?.title ?? null;
}

export function sentenceFor(row: { agentName: string | null; scopes: unknown; expiresAt: Date }, workspaceTitle: string | null, now = new Date()) {
  return describeAgentAccess({ agentName: row.agentName ?? "This agent", workspaceTitle, scopes: [...effectiveScopes("agent", row.scopes)], expiresAt: row.expiresAt, now });
}

export async function changeAgentAccess(userId: string, sessionId: string, choice: AgentAccessChoice, now = new Date()) {
  const row = await ownAgent(userId, sessionId, now);
  if (!row) throw new Error("This agent sign-in was not found, or has ended");
  const problem = await agentWorkspaceProblem(userId, choice.access, choice.workspace);
  if (problem) throw new Error(problem);
  const all = choice.workspace === "all";
  const [updated] = await db.update(extensionDeviceSessions).set({
    scopes: scopesForPreset(choice.access, choice.extraScopes),
    workspaceId: all ? null : choice.workspace,
    allWorkspaces: all,
    ...(choice.expiryDays ? { expiresAt: new Date(now.getTime() + choice.expiryDays * DAY_MS) } : {}),
  }).where(eq(extensionDeviceSessions.id, sessionId)).returning();
  return { label: `${row.agentName ?? "Agent"} on ${row.deviceName}`, sentence: sentenceFor(updated!, await titleOf(updated!.workspaceId), now) };
}

export async function renewAgentAccess(userId: string, sessionId: string, expiryDays: 7 | 30 | 90, now = new Date()) {
  const row = await ownAgent(userId, sessionId, now);
  if (!row) throw new Error("This agent sign-in was not found, or has already ended. Sign in again from the terminal.");
  const [updated] = await db.update(extensionDeviceSessions).set({ expiresAt: new Date(now.getTime() + expiryDays * DAY_MS) })
    .where(eq(extensionDeviceSessions.id, sessionId)).returning();
  return { label: `${row.agentName ?? "Agent"} on ${row.deviceName}`, sentence: sentenceFor(updated!, await titleOf(updated!.workspaceId), now) };
}

/** The daily job: one inbox item per agent sign-in that ends within 7 days (deduplicated by its end date). */
export async function sendAgentRenewalNotices(now = new Date()) {
  const ending = await db.select({ id: extensionDeviceSessions.id, userId: extensionDeviceSessions.userId, agentName: extensionDeviceSessions.agentName, deviceName: extensionDeviceSessions.deviceName, expiresAt: extensionDeviceSessions.expiresAt })
    .from(extensionDeviceSessions)
    .where(and(eq(extensionDeviceSessions.tokenType, "agent"), isNull(extensionDeviceSessions.revokedAt), gt(extensionDeviceSessions.expiresAt, now), lte(extensionDeviceSessions.expiresAt, new Date(now.getTime() + 7 * DAY_MS))));
  if (!ending.length) return { sent: 0 };
  await enqueueNotificationFanout({
    source: "agent-access-renewal",
    writes: ending.map((s) => {
      const days = Math.max(1, Math.ceil((s.expiresAt.getTime() - now.getTime()) / DAY_MS));
      return {
        operation: "create" as const,
        input: {
          recipientUserId: s.userId, actorUserId: null, kind: "agent_access_expiring" as const, category: "workflows" as const, importance: "important" as const,
          title: `Renew ${s.agentName?.trim() || "your AI agent"}: one click`.slice(0, 200),
          body: `Its access on ${s.deviceName} ends in ${days} day${days === 1 ? "" : "s"}. Renewing keeps the same settings.`,
          href: `/settings/agents/${s.id}`,
          entityRefs: {},
          dedupeKey: `renew:${s.id}:${s.expiresAt.toISOString().slice(0, 10)}`,
        },
      };
    }),
  });
  return { sent: ending.length };
}

/** Everything the agent's Settings page shows, or null when it isn't this person's live agent sign-in. */
export async function agentSettingsView(userId: string, sessionId: string, now = new Date()) {
  const row = await ownAgent(userId, sessionId, now);
  if (!row) return null;
  const workspaceTitle = await titleOf(row.workspaceId);
  const scopes = [...effectiveScopes("agent", row.scopes)];
  const requests = await openAccessRequests(userId, sessionId, now);
  return {
    id: row.id,
    agentName: row.agentName ?? "AI agent",
    deviceName: row.deviceName,
    sentence: sentenceFor(row, workspaceTitle, now),
    preset: presetOf(scopes),
    extraScopes: scopes,
    workspace: row.allWorkspaces ? ("all" as const) : row.workspaceId,
    workspaceTitle,
    expiresAt: row.expiresAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    requests: requests.map((r) => ({ id: r.id, scope: r.scope, words: accessRequestWords(r.scope), reason: r.reason, createdAt: r.createdAt.toISOString() })),
  };
}
