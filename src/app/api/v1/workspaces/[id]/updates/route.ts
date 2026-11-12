import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { createWorkspaceUpdateAction, readWorkspaceUpdatesAction } from "@/app/actions/workspace/updates";
import { agentGate } from "@/lib/agents/policy";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ content: z.string().trim().min(1).max(5000) });

/** Post an update to the workspace (`nb update post`; report D25). Everyone in it sees it, so an agent asks first. */
async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !z.string().uuid().safeParse(id).success) return jsonError("Write the update's text", 400, "BAD_REQUEST");
    const held = await agentGate(auth, request, parsed.data, { workspaceId: id, kinds: ["message"], summary: "Post an update everyone in the workspace sees", preview: parsed.data.content });
    if (held) return held;
    const result = await createWorkspaceUpdateAction(id, { content: parsed.data.content });
    if (!result.success) return jsonError(result.error ?? "Couldn’t post the update", 403, "FORBIDDEN");
    return jsonSuccess(result);
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/updates", fallback: "Couldn’t post the update" });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "workspace.updates", (req) => handlePost(req, context));
}

/** The workspace's feed (`nb update list`, report C4): the same posts, order and pages as the app. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Workspace not found", 404, "NOT_FOUND");
    const result = await readWorkspaceUpdatesAction(id, { cursor: new URL(request.url).searchParams.get("cursor") });
    if (!result.success) return jsonError(result.error ?? "Updates aren’t available", 403, "FORBIDDEN");
    return jsonSuccess(result.data, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/updates", fallback: "Couldn’t read the updates" });
  }
}
