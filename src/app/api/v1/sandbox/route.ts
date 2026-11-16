import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { startSandbox } from "@/lib/workspaces/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** nb learn (report C1, C15): your practice workspace, the one you have or a new one. Your own sign-in only. */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind === "agent") return jsonError("Practice is for people; sign in with nb login", 403, "AGENT_NOT_ALLOWED");
    if (!(await consumeRateLimit(`api:v1:sandbox:${auth.user.id}`, 10, 86_400)).allowed) return jsonError("That's a lot of practice today; try again tomorrow", 429, "RATE_LIMITED");
    const sandbox = await startSandbox(auth.user.id);
    return jsonSuccess({ sandbox });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/sandbox", fallback: "Couldn’t make the practice workspace" });
  }
}
