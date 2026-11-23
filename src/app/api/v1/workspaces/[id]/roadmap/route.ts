import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readRoadmapAction } from "@/app/actions/roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 38.9 W12 (`nb roadmap list`, networkbase_roadmap_list, plan A2.10): a workspace's roadmap items with their
 * column, stage, type and progress. Members and viewers only.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readRoadmapAction(id);
    if (!r.success) return jsonError(r.error, 404, "NOT_FOUND");
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return jsonSuccess({
      projectKey: r.projectKey,
      items: r.items.map((i) => ({ id: i.id, number: i.taskNumber, title: i.title, stage: i.stage, column: str(i.typeFields.column), type: str(i.typeFields.itemType) ?? "feature",
        milestone: str(i.typeFields.milestone), outcome: str(i.typeFields.outcome), target: i.dueDate, assignee: i.assigneeName, assigneeId: i.assigneeId, progress: i.progress, work: i.workCount })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/roadmap", fallback: "Couldn’t read the roadmap" });
  }
}
