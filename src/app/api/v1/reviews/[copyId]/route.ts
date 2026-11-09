import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { reviewAssignmentCopyAction } from "@/app/actions/assignments";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }).strict(),
  z.object({ decision: z.literal("return"), reason: z.string().trim().min(1).max(2000), fixBy: z.string().datetime().optional() }).strict(),
]);

/** Approve or return a hand-in (`nb review approve|return`, report A8.5): the app's review, a reason to return. */
export async function POST(request: Request, context: { params: Promise<{ copyId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = z.string().uuid().safeParse((await context.params).copyId);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return jsonError("approve, or return with a reason", 400, "BAD_REQUEST");
    const result = body.data.decision === "approve"
      ? await reviewAssignmentCopyAction(id.data, "approve")
      : await reviewAssignmentCopyAction(id.data, "return", body.data.reason, undefined, body.data.fixBy ? { fixBy: body.data.fixBy } : {});
    if (!result.success) return jsonError(result.error, 409, "CONFLICT");
    return jsonSuccess({ decision: body.data.decision });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/reviews/decide", fallback: "Couldn’t save the review" });
  }
}
