import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { sentenceFor } from "@/lib/agents/access-settings";
import { db } from "@/lib/db";
import { extensionDeviceSessions, personalAccessTokens, workspaces } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your signed-in devices, agents and personal tokens (`nb token list`, report A3.9): names, types, workspace, last
 * use; never the tokens. Agent tokens can't list them (token-access.ts has no agent mode for this route).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const now = new Date();
    const [sessions, pats] = await Promise.all([
      db.select({ id: extensionDeviceSessions.id, name: extensionDeviceSessions.deviceName, type: extensionDeviceSessions.tokenType, agentName: extensionDeviceSessions.agentName, workspaceId: extensionDeviceSessions.workspaceId, lastUsedAt: extensionDeviceSessions.lastSeenAt, createdAt: extensionDeviceSessions.createdAt, expiresAt: extensionDeviceSessions.expiresAt, country: extensionDeviceSessions.lastCountry, scopes: extensionDeviceSessions.scopes })
        .from(extensionDeviceSessions).where(and(eq(extensionDeviceSessions.userId, auth.user.id), isNull(extensionDeviceSessions.revokedAt), gt(extensionDeviceSessions.expiresAt, now))).orderBy(desc(extensionDeviceSessions.lastSeenAt)).limit(100),
      db.select({ id: personalAccessTokens.id, name: personalAccessTokens.label, workspaceId: personalAccessTokens.workspaceId, lastUsedAt: personalAccessTokens.lastUsedAt, createdAt: personalAccessTokens.createdAt, expiresAt: personalAccessTokens.expiresAt })
        .from(personalAccessTokens).where(and(eq(personalAccessTokens.userId, auth.user.id), isNull(personalAccessTokens.revokedAt), or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, now)))).orderBy(desc(personalAccessTokens.createdAt)).limit(100),
    ]);
    const ids = [...new Set([...sessions, ...pats].map((t) => t.workspaceId).filter((x): x is string => Boolean(x)))];
    const found = ids.length ? await db.select({ id: workspaces.id, slug: workspaces.slug, title: workspaces.title }).from(workspaces).where(inArray(workspaces.id, ids)) : [];
    const names = new Map(found.map((w) => [w.id, w.slug ?? w.title]));
    const titles = new Map(found.map((w) => [w.id, w.title]));
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return jsonSuccess({
      tokens: [
        ...sessions.map((t) => ({ id: t.id, type: t.type, name: t.name, agentName: t.agentName, workspace: t.workspaceId ? names.get(t.workspaceId) ?? null : null, lastUsedAt: iso(t.lastUsedAt), createdAt: iso(t.createdAt), expiresAt: iso(t.expiresAt), country: t.country, current: t.id === auth.extensionSessionId,
          // The same sentence as the approval page and Settings (report A4 "Afterwards", A6 #5).
          ...(t.type === "agent" ? { access: sentenceFor(t, t.workspaceId ? titles.get(t.workspaceId) ?? null : null, now) } : {}) })),
        ...pats.map((t) => ({ id: t.id, type: "personal", name: t.name, agentName: null, workspace: t.workspaceId ? names.get(t.workspaceId) ?? null : null, lastUsedAt: iso(t.lastUsedAt), createdAt: iso(t.createdAt), expiresAt: iso(t.expiresAt), country: null, current: t.id === auth.extensionSessionId })),
      ],
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tokens", fallback: "Couldn’t list your tokens" });
  }
}
