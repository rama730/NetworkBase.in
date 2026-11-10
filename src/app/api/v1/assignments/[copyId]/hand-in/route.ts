import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { submitAssignmentAction, unsubmitAssignmentAction } from "@/app/actions/assignments";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ link: z.string().trim().max(2000).optional(), text: z.string().max(10000).optional(), note: z.string().max(500).optional() }).strict();

/**
 * Hand in a copy (`nb assignment hand-in`, report A8.4) through the app's own Submit: the same late, closed, lock and
 * submission-type rules. Agent tokens can't call it (token-access.ts): handing in is the person's act.
 */
export async function POST(request: Request, context: { params: Promise<{ copyId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = z.string().uuid().safeParse((await context.params).copyId);
    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!id.success || !body.success) return jsonError("Check what you're handing in", 400, "BAD_REQUEST");
    const result = await submitAssignmentAction(id.data, body.data);
    if (!result.success) return jsonError(result.error, 409, "CONFLICT");
    return jsonSuccess({ handedIn: true });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/assignments/hand-in", fallback: "Couldn’t hand it in" });
  }
}

/**
 * Take back a hand-in (`nb assignment unsubmit`): back to In progress before anyone approves it, by the app's own
 * rule. The same permission as handing in, and agent tokens can't call it either.
 */
export async function DELETE(request: Request, context: { params: Promise<{ copyId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = z.string().uuid().safeParse((await context.params).copyId);
    if (!id.success) return jsonError("Check which assignment", 400, "BAD_REQUEST");
    const result = await unsubmitAssignmentAction(id.data);
    if (!result.success) return jsonError(result.error, 409, "CONFLICT");
    return jsonSuccess({ handedIn: false });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/assignments/hand-in", fallback: "Couldn’t take it back" });
  }
}
