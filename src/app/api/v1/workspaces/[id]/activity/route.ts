import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { labelScopes, visibleViaOfPayload } from "@/lib/agents/via-scope";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, taskActivityEvents, tasks, workspaceNodeEvents, workspaceNodes } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ since: z.string().datetime().optional(), before: z.string().datetime().optional(), task: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

/**
 * What happened in a workspace, newest first (`nb activity`, "what changed on task 4 since yesterday"; report A2.5):
 * task events and file events, each with who did it and whether it came through the CLI or an agent.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("Invalid activity query", 400, "BAD_REQUEST");
    const q = parsed.data;
    const access = await getWorkspaceAccessById(id, auth.user.id);
    if (!access.project || !canReadWorkspaceTab(access, "tasks")) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const since = q.since ? new Date(q.since) : undefined;
    const before = q.before ? new Date(q.before) : undefined;
    const [taskRows, fileRows] = await Promise.all([
      db.select({ at: taskActivityEvents.createdAt, type: taskActivityEvents.eventType, payload: taskActivityEvents.payload, actorId: taskActivityEvents.actorId, taskId: taskActivityEvents.taskId, taskNumber: tasks.taskNumber, taskTitle: tasks.title })
        .from(taskActivityEvents).innerJoin(tasks, eq(tasks.id, taskActivityEvents.taskId))
        .where(and(eq(taskActivityEvents.projectId, id), q.task ? eq(taskActivityEvents.taskId, q.task) : undefined, since ? gte(taskActivityEvents.createdAt, since) : undefined, before ? lt(taskActivityEvents.createdAt, before) : undefined))
        .orderBy(desc(taskActivityEvents.createdAt)).limit(q.limit),
      q.task || !canReadWorkspaceTab(access, "files") ? Promise.resolve([]) : db.select({ at: workspaceNodeEvents.createdAt, type: workspaceNodeEvents.type, metadata: workspaceNodeEvents.metadata, actorId: workspaceNodeEvents.actorId, path: workspaceNodes.path })
        .from(workspaceNodeEvents).leftJoin(workspaceNodes, eq(workspaceNodes.id, workspaceNodeEvents.nodeId))
        .where(and(eq(workspaceNodeEvents.projectId, id), since ? gte(workspaceNodeEvents.createdAt, since) : undefined, before ? lt(workspaceNodeEvents.createdAt, before) : undefined))
        .orderBy(desc(workspaceNodeEvents.createdAt)).limit(q.limit),
    ]);
    const actorIds = [...new Set([...taskRows, ...fileRows].map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
    const actors = actorIds.length ? await db.select({ id: profiles.id, username: profiles.username, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, actorIds)) : [];
    const who = new Map(actors.map((a) => [a.id, a.username ?? a.name ?? null]));
    // "with Claude Code" only where the workspace owner's setting allows this viewer to see it (report Part B).
    const labels = labelScopes(auth.user.id, id);
    const fileScope = await labels(null);
    const taskScopes = new Map(await Promise.all([...new Set(taskRows.map((r) => r.taskId))].map(async (t) => [t, await labels(t)] as const)));
    const items = [
      ...taskRows.map((r) => ({ at: r.at.toISOString(), kind: "task" as const, type: r.type, by: r.actorId ? who.get(r.actorId) ?? null : null, task: { id: r.taskId, number: r.taskNumber, title: r.taskTitle }, ...visibleViaOfPayload(taskScopes.get(r.taskId)!, r.payload, r.actorId),
        detail: (() => { const p = (r.payload ?? {}) as Record<string, unknown>; return p.to ? `→ ${String(p.to)}` : p.reason ? String(p.reason) : null; })() })),
      ...fileRows.map((r) => ({ at: r.at.toISOString(), kind: "file" as const, type: r.type, by: r.actorId ? who.get(r.actorId) ?? null : null, path: r.path ?? null, ...visibleViaOfPayload(fileScope, r.metadata, r.actorId), detail: null })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, q.limit);
    return jsonSuccess({ items, nextBefore: items.length === q.limit ? items.at(-1)!.at : null }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/activity", fallback: "Couldn’t read activity" });
  }
}
