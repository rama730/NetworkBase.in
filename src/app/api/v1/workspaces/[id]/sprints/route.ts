import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks, workspaceSprints, workspaces } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { sprintWords } from "@/lib/organizations/sprint-words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sprints with their task counts, in the workspace's own words (`nb sprint list`; report A8.7). `?sprint=<id>` adds its tasks. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    const sprintParam = new URL(request.url).searchParams.get("sprint");
    if (!z.string().uuid().safeParse(id).success || (sprintParam && !z.string().uuid().safeParse(sprintParam).success)) return jsonError("Invalid sprint query", 400, "BAD_REQUEST");
    const access = await getWorkspaceAccessById(id, auth.user.id);
    if (!access.project || !canReadWorkspaceTab(access, "tasks")) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const [ws] = await db.select({ orgType: workspaces.orgType, orgSettings: workspaces.orgSettings, parentId: workspaces.parentId }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
    const [org] = ws?.parentId ? await db.select({ orgType: workspaces.orgType, orgSettings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, ws.parentId)).limit(1) : [];
    const rows = await db
      .select({ id: workspaceSprints.id, number: workspaceSprints.sprintNumber, name: workspaceSprints.name, goal: workspaceSprints.goal, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate,
        open: sql<number>`count(${tasks.id}) FILTER (WHERE ${tasks.status} <> 'done')::int`, done: sql<number>`count(${tasks.id}) FILTER (WHERE ${tasks.status} = 'done')::int` })
      .from(workspaceSprints)
      .leftJoin(tasks, and(eq(tasks.sprintId, workspaceSprints.id), isNull(tasks.deletedAt)))
      .where(and(eq(workspaceSprints.projectId, id), isNull(workspaceSprints.archivedAt)))
      .groupBy(workspaceSprints.id)
      .orderBy(asc(workspaceSprints.startDate));
    const sprintTasks = sprintParam
      ? await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status }).from(tasks).where(and(eq(tasks.sprintId, sprintParam), eq(tasks.projectId, id), isNull(tasks.deletedAt))).orderBy(asc(tasks.taskNumber))
      : null;
    const [unplanned] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.projectId, id), isNull(tasks.sprintId), isNull(tasks.deletedAt), ne(tasks.status, "done")));
    return jsonSuccess({
      words: sprintWords(org?.orgType ?? ws?.orgType, org?.orgSettings ?? ws?.orgSettings),
      sprints: rows.map((r) => ({ ...r, startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString() })),
      unplanned: unplanned?.n ?? 0,
      ...(sprintTasks ? { tasks: sprintTasks } : {}),
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/sprints", fallback: "Couldn’t read sprints" });
  }
}
