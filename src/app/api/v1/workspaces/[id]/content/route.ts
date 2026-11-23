import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readContentAction } from "@/app/actions/content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 38.8 W12 (`nb content list|ideas|add`, networkbase_content_list, plan A2.9): a workspace's content pieces
 * with their channels and publish times, and its live channels and types. Members and viewers only.
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
    const r = await readContentAction(id);
    if (!r.success) return jsonError(r.error, 404, "NOT_FOUND");
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return jsonSuccess({
      projectKey: r.projectKey, timeZone: r.timeZone,
      channels: (r.settings?.channels ?? []).filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, updates: c.updates })),
      types: (r.settings?.types ?? []).map((t) => ({ id: t.id, name: t.name })),
      items: r.items.map((i) => ({ id: i.id, number: i.taskNumber, title: i.title, stage: i.stage, publishAt: typeof i.typeFields.publishAt === "string" ? i.typeFields.publishAt : null,
        channels: strings(i.typeFields.channels), type: typeof i.typeFields.contentType === "string" ? i.typeFields.contentType : null, writer: i.assigneeName, writerId: i.assigneeId,
        published: Object.keys((i.typeFields.published ?? {}) as object) })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/content", fallback: "Couldn’t read content" });
  }
}
