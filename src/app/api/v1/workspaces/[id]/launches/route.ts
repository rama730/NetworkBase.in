import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readRoadmapLaunchesAction } from "@/app/actions/roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.10 W10 (`nb launches list`, networkbase_launch_list, plan A3.1): a workspace's launches with date, stage and progress. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readRoadmapLaunchesAction(id);
    if (!r.success) return jsonError(r.error, 404, "NOT_FOUND");
    return jsonSuccess({ launches: r.launches });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/launches", fallback: "Couldn’t read launches" });
  }
}
