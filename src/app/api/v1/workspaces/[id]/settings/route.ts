import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { WorkspaceCliError, changeWorkspaceSettings, workspaceSettings } from "@/lib/workspaces/server/workspace-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const answer = (error: unknown, request: Request) => error instanceof WorkspaceCliError
  ? jsonError(error.message, error.status, error.code as never)
  : routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/settings", fallback: "Couldn’t read the settings" });

/** `nb workspace settings` (report F3): the basics, agents, history and main's protection. */
export async function GET(request: Request, context: Ctx) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    return jsonSuccess(await workspaceSettings(auth.user.id, id), undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return answer(error, request);
  }
}

/**
 * `nb workspace settings --title … --description …`: owners and admins (the app's update rules), people only.
 * `{ status: "completed" }` completes the workspace and every active part in it (member settings §3).
 */
export async function PATCH(request: Request, context: Ctx) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace.settings", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      if (auth.tokenKind === "agent") return jsonError("Agents don't change workspace settings", 403, "FORBIDDEN");
      const { id } = await context.params;
      const body = z.object({ title: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(5000).optional(), status: z.enum(["active", "completed"]).optional() })
        .refine((b) => b.title !== undefined || b.description !== undefined || b.status !== undefined).safeParse(await req.json().catch(() => null));
      if (!z.string().uuid().safeParse(id).success || !body.success) return jsonError("Send { title }, { description } or { status }", 400, "BAD_REQUEST");
      if (body.data.status === "completed" && auth.tokenScopes) {
        const { requireStepUp } = await import("@/lib/security/cli-step-up");
        const refused = await requireStepUp(auth, req, "complete a workspace");
        if (refused) return refused;
      }
      await changeWorkspaceSettings(id, body.data);
      return jsonSuccess(await workspaceSettings(auth.user.id, id));
    } catch (error) {
      return answer(error, request);
    }
  });
}
