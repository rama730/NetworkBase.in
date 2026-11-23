import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readRequestsAction } from "@/app/actions/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 38.7 W13 (`nb requests list`, networkbase_request_list, plan A2.6): a workspace's requests with their clocks
 * worked out, and its request types (for `nb requests new --type`). Members and viewers only.
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
    const r = await readRequestsAction(id);
    if (!r.success) return jsonError(r.error, 404, "NOT_FOUND");
    return jsonSuccess({
      projectKey: r.projectKey, timeZone: r.timeZone, canTriage: r.canTriage,
      types: r.types.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name, questions: t.questions, firstReplyMinutes: t.firstReplyMinutes, deliverMinutes: t.deliverMinutes })),
      requests: r.requests.map((q) => ({ id: q.id, number: q.taskNumber, title: q.title, stage: q.stage, needBy: q.dueDate, assignee: q.assigneeName, assigneeId: q.assigneeId, askedBy: q.creatorName, askedById: q.creatorId,
        type: r.types.find((t) => t.id === q.typeFields.requestTypeId)?.name ?? null, clock: q.clock, waiting: Boolean((q.typeFields.waiting as { since?: string } | null)?.since), solved: q.typeFields.solved ?? null })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/requests", fallback: "Couldn’t read requests" });
  }
}
