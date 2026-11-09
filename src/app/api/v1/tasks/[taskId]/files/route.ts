import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser, requireTokenScope } from "@/app/api/v1/_shared";
import { linkNodeToTask, unlinkNodeFromTask } from "@/app/actions/files/links";
import { agentGate, isOthersTask } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { tasks, workspaceNodes } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";
import { fromPublicRole } from "@/lib/workspaces/task-file-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ projectId: z.string().uuid(), path: z.string().min(1).max(2048), as: z.enum(["reference", "draft", "final"]).default("draft"), detach: z.boolean().optional() });

/** Attach a file that's already in the workspace to a task with a role, or take it off (`nb file attach|detach`). */
async function handlePost(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const taskId = (await context.params).taskId;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !z.string().uuid().safeParse(taskId).success) return jsonError("Invalid attach request", 400, "BAD_REQUEST");
    const { projectId, path, as, detach } = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { projectId, taskId });
    if (outside) return outside;
    if (as === "final") {
      const denied = requireTokenScope(auth, "file:final");
      if (denied) return denied;
    }
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1);
    if (!task) return jsonError("Task not found", 404, "NOT_FOUND");
    const normalized = `/${path.replace(/^\/+/, "")}`;
    const [node] = await db.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.path, normalized), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt))).limit(1);
    if (!node) return jsonError(`No file ${normalized} in this workspace`, 404, "NOT_FOUND");
    const held = await agentGate(auth, request, parsed.data, {
      workspaceId: projectId,
      kinds: [as === "final" && !detach ? "final" : "small", (await isOthersTask(taskId, auth.user.id)) ? "others-task" : "small"],
      summary: detach ? `Take ${normalized} off the task` : `Attach ${normalized} to the task as ${as}`,
    });
    if (held) return held;
    if (detach) {
      await unlinkNodeFromTask(taskId, node.id);
      return jsonSuccess({ detached: normalized });
    }
    await linkNodeToTask(taskId, node.id, { role: fromPublicRole(as) ?? "working" });
    return jsonSuccess({ attached: normalized, as });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/files", fallback: "Couldn’t attach the file" });
  }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return idempotentWrite(request, "task.files", (req) => handlePost(req, context));
}
