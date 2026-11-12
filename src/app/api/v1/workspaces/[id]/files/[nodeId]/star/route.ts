import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { setNodeStar, TaskMetaError } from "@/lib/domain/task-meta";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `nb file star <file>` (report C3): your own shortcut, shared with the Files tab (0087). */
export async function PUT(request: Request, context: { params: Promise<{ id: string; nodeId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id, nodeId } = await context.params;
    const parsed = z.object({ starred: z.boolean() }).safeParse(await request.json().catch(() => null));
    if (!UUID.test(id) || !UUID.test(nodeId) || !parsed.success) return jsonError("Say starred: true or false", 400, "BAD_REQUEST");
    await setNodeStar(auth.user.id, id, nodeId, parsed.data.starred);
    return jsonSuccess({ nodeId, starred: parsed.data.starred });
  } catch (error) {
    if (error instanceof TaskMetaError) return jsonError(error.message, error.status, error.status === 404 ? "NOT_FOUND" : "FORBIDDEN");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/files/star", fallback: "Couldn’t star the file" });
  }
}
