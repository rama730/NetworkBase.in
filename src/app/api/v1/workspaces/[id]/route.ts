import { and, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { tasks, workspaceNodes, workspaceSprints, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { sprintWords } from "@/lib/organizations/sprint-words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One workspace at a glance (`nb workspace view`, `networkbase_workspace_view`; report A2.5, A8.7). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z.string().uuid().safeParse((await context.params).id);
    if (!parsed.success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const id = parsed.data;
    const access = await getWorkspaceAccessById(id, auth.user.id);
    if (!access.canRead || !access.project) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const [ws] = await db.select({ title: workspaces.title, slug: workspaces.slug, description: workspaces.description, kind: workspaces.kind, orgType: workspaces.orgType, orgSettings: workspaces.orgSettings, parentId: workspaces.parentId, agentPolicy: workspaces.agentPolicy, agentsPausedAt: workspaces.agentsPausedAt })
      .from(workspaces).where(eq(workspaces.id, id)).limit(1);
    const [org] = ws?.parentId ? await db.select({ orgType: workspaces.orgType, orgSettings: workspaces.orgSettings, title: workspaces.title }).from(workspaces).where(eq(workspaces.id, ws.parentId)).limit(1) : [];
    const [[open], [files], sprints] = await Promise.all([
      db.select({ n: count() }).from(tasks).where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt), ne(tasks.status, "done"))),
      db.select({ n: count() }).from(workspaceNodes).where(and(eq(workspaceNodes.projectId, id), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt))),
      db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(and(eq(workspaceSprints.projectId, id), eq(workspaceSprints.status, "active"))).limit(1),
    ]);
    return jsonSuccess({
      id, title: ws?.title ?? null, slug: ws?.slug ?? null, description: ws?.description ?? null, kind: ws?.kind ?? "workspace",
      role: access.isOwner ? "owner" : access.memberRole ?? (access.isInheritedAdmin ? "admin" : "viewer"), canWrite: access.canWrite,
      openTasks: open?.n ?? 0, files: files?.n ?? 0,
      currentSprint: sprints[0] ? { id: sprints[0].id, name: sprints[0].name, endDate: sprints[0].endDate.toISOString() } : null,
      words: sprintWords(org?.orgType ?? ws?.orgType, org?.orgSettings ?? ws?.orgSettings),
      organization: org ? { title: org.title } : null,
      agents: { policy: ws?.agentPolicy ?? "ask_important", paused: Boolean(ws?.agentsPausedAt) },
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/id", fallback: "Couldn’t read the workspace" });
  }
}
