import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { recordGlobalSearchMetric } from "@/lib/search/observability";
import { logSearch } from "@/lib/search/global/extras";
import { parseSearchParams } from "@/lib/search/global/params";
import { runGlobalSearch } from "@/lib/search/global/run";

/**
 * One search for the whole app (global search mix §5): the box calls this on every keystroke (old calls are
 * aborted), so it is a GET, never a server action that would queue behind other clicks.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  const limited = await enforceRouteLimit(request, "api:v1:search", 240, 60, "signedInRead", auth.user.id);
  if (limited) {
    recordGlobalSearchMetric({ domain: "everything", outcome: "rate-limited", durationMs: Date.now() - startedAt, resultCount: 0, queryLength: 0, tokenCount: 0 });
    return limited;
  }

  const parsed = parseSearchParams(new URL(request.url).searchParams);
  if (!parsed.ok) return jsonError(parsed.error, 400, "BAD_REQUEST");
  const input = parsed.value;
  try {
    const result = await runGlobalSearch({ viewerId: auth.user.id, q: input.q, ctx: input.ctx, place: input.place, scope: input.scope, perKind: input.per, exact: input.exact });
    if (input.log) void logSearch(auth.user.id, result.q);
    const count = Object.values(result.counts).reduce((sum, value) => sum + (value ?? 0), 0);
    recordGlobalSearchMetric({
      domain: "everything", scope: input.ctx, outcome: count ? "success" : "empty", durationMs: Date.now() - startedAt,
      resultCount: count, queryLength: input.q.length, tokenCount: input.q.split(" ").length,
    });
    // Never in the HTTP cache: on a shared computer the next account would get these results. The box keeps 60 s itself.
    return jsonSuccess(result, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    recordGlobalSearchMetric({ domain: "everything", scope: input.ctx, outcome: "error", durationMs: Date.now() - startedAt, resultCount: 0, queryLength: input.q.length, tokenCount: 0 });
    return routeErrorResponse(error, { requestId, scope: "global_search", fallback: "Couldn’t search just now" });
  }
}
