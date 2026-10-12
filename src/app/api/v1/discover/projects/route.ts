import { z } from "zod";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { fetchDiscoverProjectsAction } from "@/app/actions/discover";
import { SORT_OPTIONS } from "@/constants/discover";
import { parseDiscoverQuery } from "@/lib/discover/query";

/**
 * The Discover feed for filtered, searched and ranked views. A plain GET (not a server action), so the
 * browser can cancel a slow search and a follow isn't queued behind it. The rules are the action's: the
 * same validation, rate limits and privacy filtering.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
  cursor: z.string().max(1000).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!params.success) return jsonError("Invalid pagination parameters", 400, "BAD_REQUEST");

  const query = parseDiscoverQuery((key) => url.searchParams.get(key));
  const filters = {
    status: query.status,
    type: query.type,
    tech: query.tech,
    sort: query.view === "trending" ? SORT_OPTIONS.TRENDING : query.sort,
    search: query.q || undefined,
  };

  const result = await fetchDiscoverProjectsAction(filters, params.data.cursor, params.data.limit, query.view, "full");
  if (!result.success) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "VALIDATION" || result.code === "STALE_FEED" ? 400 : 503;
    const errorCode = result.code === "RATE_LIMITED" ? "RATE_LIMITED" : result.code === "VALIDATION" || result.code === "STALE_FEED" ? "BAD_REQUEST" : "INTERNAL_ERROR";
    return jsonError(result.error, status, errorCode, { code: result.code, retryAfterMs: "retryAfterMs" in result ? result.retryAfterMs : undefined });
  }
  return jsonSuccess({ projects: result.projects, nextCursor: result.nextCursor ?? null, hasMore: result.hasMore });
}
