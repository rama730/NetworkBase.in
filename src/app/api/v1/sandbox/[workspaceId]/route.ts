import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { endSandbox } from "@/lib/workspaces/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ workspaceId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The end of nb learn: deletes your practice workspace. Only ever a practice workspace of yours. */
export async function DELETE(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind === "agent") return jsonError("Practice is for people; sign in with nb login", 403, "AGENT_NOT_ALLOWED");
    const { workspaceId } = await context.params;
    if (!UUID.test(workspaceId) || !(await endSandbox(auth.user.id, workspaceId))) return jsonError("No practice workspace of yours with that id", 404, "NOT_FOUND");
    return jsonSuccess({ deleted: workspaceId });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/sandbox", fallback: "Couldn’t delete the practice workspace" });
  }
}
