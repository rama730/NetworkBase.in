import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { requireStepUp } from "@/lib/security/cli-step-up";
import { validateCsrf } from "@/lib/security/csrf";
import { WorkspaceCliError, archiveWorkspaceFromCli } from "@/lib/workspaces/server/workspace-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `nb workspace archive` (report F3): the owner, people only, after "Verify it's you" (F5). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace.archive", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      const { id } = await context.params;
      if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
      const refused = await requireStepUp(auth, req, "archive a workspace");
      if (refused) return refused;
      return jsonSuccess(await archiveWorkspaceFromCli(id));
    } catch (error) {
      if (error instanceof WorkspaceCliError) return jsonError(error.message, error.status, error.code as never);
      return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/archive", fallback: "Couldn’t archive the workspace" });
    }
  });
}
