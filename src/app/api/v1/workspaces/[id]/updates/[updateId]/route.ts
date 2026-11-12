import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { createWorkspaceUpdateCommentAction, readWorkspaceUpdateCommentsAction, toggleWorkspaceUpdateLikeAction } from "@/app/actions/workspace/updates";
import { agentGate } from "@/lib/agents/policy";
import { updateActionSchema } from "@/lib/api/v1-schemas";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; updateId: string }> };
const ids = async (context: Context) => {
  const { id, updateId } = await context.params;
  return z.string().uuid().safeParse(id).success && z.string().uuid().safeParse(updateId).success ? { id, updateId } : null;
};

/** One update's comments (`nb update view`, report C4). */
export async function GET(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const ref = await ids(context);
    if (!ref) return jsonError("Update not found", 404, "NOT_FOUND");
    const result = await readWorkspaceUpdateCommentsAction(ref.id, ref.updateId, new URL(request.url).searchParams.get("cursor"));
    if (!result.success) return jsonError(result.error ?? "This update isn’t available", 404, "NOT_FOUND");
    return jsonSuccess(result.data, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/updates/one", fallback: "Couldn’t read the update" });
  }
}


/** Like (it toggles, as in the app) or comment on an update (`nb update like`, `nb update comment`). */
async function handlePost(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const ref = await ids(context);
    const parsed = updateActionSchema.safeParse(await request.json().catch(() => null));
    if (!ref || !parsed.success) return jsonError("Like it, or say what to comment", 400, "BAD_REQUEST");
    // A comment is public to the workspace: an agent's person agrees first.
    if (parsed.data.kind === "comment") {
      const held = await agentGate(auth, request, parsed.data, { workspaceId: ref.id, kinds: ["review"], summary: "Comment on an update everyone sees", preview: parsed.data.text });
      if (held) return held;
    }
    const result = parsed.data.kind === "like"
      ? await toggleWorkspaceUpdateLikeAction(ref.id, ref.updateId)
      : await createWorkspaceUpdateCommentAction(ref.id, ref.updateId, parsed.data.text, parsed.data.parentId ?? null);
    if (!result.success) return jsonError(result.error ?? "Couldn’t do that", 403, "FORBIDDEN");
    return jsonSuccess("data" in result ? result.data : result);
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/updates/one", fallback: "Couldn’t do that" });
  }
}

export async function POST(request: Request, context: Context) {
  return idempotentWrite(request, "workspace.updates.one", (req) => handlePost(req, context));
}
