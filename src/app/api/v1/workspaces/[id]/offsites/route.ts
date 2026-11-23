import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readUpcomingOffsitesAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.14 W7 (`nb offsites list`, plan A5.4): off-sites still ahead, with answers. Members only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readUpcomingOffsitesAction(id, 3650);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    return jsonSuccess({ offsites: r.offsites });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/offsites", fallback: "Couldn’t read off-sites" });
  }
}
