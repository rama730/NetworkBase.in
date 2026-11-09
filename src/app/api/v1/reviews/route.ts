import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readReviewQueueAction } from "@/app/actions/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An organization's review queue (`nb review list`, report A8.5); the app's queue, same reviewers and Mine. */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const url = new URL(request.url);
    const org = z.string().uuid().safeParse(url.searchParams.get("org"));
    if (!org.success) return jsonError("Which organization? Pass ?org=<id>", 400, "BAD_REQUEST");
    const result = await readReviewQueueAction(org.data, url.searchParams.get("cursor"));
    if (!result.success) return jsonError(result.error, 403, "FORBIDDEN");
    const mine = url.searchParams.get("mine") === "1";
    return jsonSuccess({ rows: mine ? result.rows.filter((r) => r.mine) : result.rows, total: result.total, nextCursor: result.nextCursor });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/reviews", fallback: "Couldn’t load the review queue" });
  }
}
