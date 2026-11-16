import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { undoOperations, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * `nb agent activity` (report F4): what your agents did here in the last 24 hours, one group per agent session, with
 * the undo ids still usable. Agent tokens can't call it (token rules): it's the person's view of them.
 */
export async function GET(request: Request, context: Ctx) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const access = await getWorkspaceAccessById(id, auth.user.id);
    if (!access.canRead || !access.project) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const rows = await db.select({ id: undoOperations.id, session: undoOperations.sessionId, agent: undoOperations.agentName, summary: undoOperations.summary, at: undoOperations.createdAt, expiresAt: undoOperations.expiresAt, usedAt: undoOperations.usedAt })
      .from(undoOperations)
      .where(and(eq(undoOperations.userId, auth.user.id), eq(undoOperations.workspaceId, id), eq(undoOperations.via, "agent"), gt(undoOperations.createdAt, sql`now() - interval '24 hours'`)))
      .orderBy(desc(undoOperations.createdAt)).limit(500);
    const now = Date.now();
    const groups = new Map<string, { session: string | null; agent: string | null; first: string; last: string; changes: Array<{ id: string; summary: string; at: string; undone: boolean; undoable: boolean }> }>();
    for (const r of rows) {
      const key = r.session ?? "none";
      const g = groups.get(key) ?? { session: r.session, agent: r.agent, first: r.at.toISOString(), last: r.at.toISOString(), changes: [] };
      g.first = r.at.toISOString();
      g.changes.push({ id: r.id, summary: r.summary, at: r.at.toISOString(), undone: Boolean(r.usedAt), undoable: !r.usedAt && r.expiresAt.getTime() > now });
      groups.set(key, g);
    }
    return jsonSuccess({ sessions: [...groups.values()] }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/agents", fallback: "Couldn’t read agent activity" });
  }
}

/** `nb agent pause` / `resume` (report F4): the switch in workspace settings, for its owner and admins. */
export async function POST(request: Request, context: Ctx) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace-agents", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      // An agent never switches agents back on (token rules refuse agent tokens here too).
      if (auth.tokenKind === "agent") return jsonError("Agents can't pause or resume agents", 403, "FORBIDDEN");
      // A personal access token (CI, scripts) never flips the switch: only the person's own sign-in or the app.
      if (auth.tokenKind === "pat") return jsonError("Pause or resume agents from your own sign-in (nb login) or the app", 403, "FORBIDDEN");
      const id = (await context.params).id;
      const body = z.object({ paused: z.boolean() }).safeParse(await req.json().catch(() => null));
      if (!z.string().uuid().safeParse(id).success || !body.success) return jsonError("Send { paused: true | false }", 400, "BAD_REQUEST");
      const access = await getWorkspaceAccessById(id, auth.user.id);
      if (!access.project) return jsonError("Workspace not found", 404, "NOT_FOUND");
      if (!access.isOwner && access.memberRole !== "admin") return jsonError("Only the workspace owner and admins can pause agents", 403, "FORBIDDEN");
      const [row] = await db.update(workspaces).set({ agentsPausedAt: body.data.paused ? sql`coalesce(${workspaces.agentsPausedAt}, now())` : null, updatedAt: new Date() })
        .where(eq(workspaces.id, id)).returning({ pausedAt: workspaces.agentsPausedAt });
      return jsonSuccess({ paused: Boolean(row?.pausedAt), pausedAt: row?.pausedAt?.toISOString() ?? null });
    } catch (error) {
      return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/agents", fallback: "Couldn’t change agent settings" });
    }
  });
}
