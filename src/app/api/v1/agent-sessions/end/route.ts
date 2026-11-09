import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { flushAgentSession } from "@/lib/agents/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSRF exemption: only bearer tokens reach this (a browser session gets 400), and it only sends what the token's
// own session already queued.
const csrfProtection = "bearer-only" as const;
void csrfProtection;

/** The agent disconnected (`nb mcp` exits): send its held notifications now as one summary (report A11.6). */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind !== "agent" || !auth.extensionSessionId) return jsonSuccess({ sent: 0 });
    return jsonSuccess(await flushAgentSession(auth.extensionSessionId));
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/agent-sessions/end", fallback: "Couldn’t end the agent session" });
  }
}
