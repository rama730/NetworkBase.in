import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { createWorkspaceUpdateAction, readScheduledUpdatesAction, readWorkspaceUpdatesAction, scheduleWorkspaceUpdateAction } from "@/app/actions/workspace/updates";
import { agentGate } from "@/lib/agents/policy";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ content: z.string().trim().min(1).max(5000), publishAt: z.string().datetime({ offset: true }).optional(), release: z.boolean().optional() });

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
    const { content, publishAt, release } = parsed.data;
    const held = await agentGate(auth, request, parsed.data, { workspaceId: id, kinds: ["message"], summary: publishAt ? `Schedule an update to post at ${publishAt}` : "Post an update everyone in the workspace sees", preview: content });
    if (held) return held;
    // `nb update schedule --at …` (report 38.17 W7, A7.4): it posts at that time as you.
    if (publishAt) {
      const scheduled = await scheduleWorkspaceUpdateAction(id, { content, publishAt, updateType: release ? "release" : null });
      if (!scheduled.success) return jsonError(scheduled.error, 400, "BAD_REQUEST");
      return jsonSuccess({ scheduled: { id: scheduled.id, publishAt: scheduled.publishAt } });
    }
    const result = await createWorkspaceUpdateAction(id, { content, updateType: release ? "release" : null });
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
    const q = new URL(request.url).searchParams;
    // `nb update scheduled` (A7.4): what waits to post.
    if (q.get("scheduled")) {
      const scheduled = await readScheduledUpdatesAction(id);
      if (!scheduled.success) return jsonError(scheduled.error, 403, "FORBIDDEN");
      return jsonSuccess({ scheduled: scheduled.scheduled }, undefined, { headers: { "Cache-Control": "private, no-store" } });
    }
    // `nb changelog` (A7.5): release Updates only.
    const result = await readWorkspaceUpdatesAction(id, { cursor: q.get("cursor"), ...(q.get("filter") === "release" ? { filter: "release" } : {}) });
    if (!result.success) return jsonError(result.error ?? "Updates aren’t available", 403, "FORBIDDEN");
    return jsonSuccess(result.data, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/updates", fallback: "Couldn’t read the updates" });
  }
}
