import { createHash } from "node:crypto";
import { z } from "zod";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { SORT_OPTIONS } from "@/constants/discover";
import { getDiscoverUpdatesPage, InvalidDiscoverUpdatesCursorError } from "@/lib/data/discover-updates";
import { parseDiscoverQuery } from "@/lib/discover/query";
import { logger } from "@/lib/logger";
import { consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

/**
 * One page of project updates for the Discover feed. A plain GET so the browser can cancel a superseded
 * search. It answers to the same filters as the project cards, and every answer is per viewer (their likes,
 * their blocks), so nothing is cached.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(8),
  cursor: z.string().max(300).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!params.success) return jsonError("Invalid pagination parameters", 400, "BAD_REQUEST");

  const query = parseDiscoverQuery((key) => url.searchParams.get(key));
  const { user } = await getViewerAuthContext();
  const ip = getTrustedRequestIp(request)
    ?? `fp:${createHash("sha1").update(`${request.headers.get("user-agent") ?? ""}|${request.headers.get("accept-language") ?? ""}`).digest("hex").slice(0, 16)}`;
  const limit = await consumeRateLimitForRoute("publicRead", `discover-updates:${user?.id ?? `anon:${ip}`}`, 180, 60);
  // A limiter outage is not the viewer's fault: let the read through rather than say "too many".
  if (!limit.allowed && !limit.degraded) return jsonError("Too many requests. Please wait a moment and try again.", 429, "RATE_LIMITED");

  try {
    const page = await getDiscoverUpdatesPage({
      filters: { status: query.status, type: query.type, tech: query.tech, sort: SORT_OPTIONS.NEWEST, search: query.q || undefined },
      view: query.view,
      viewerId: user?.id ?? null,
      limit: params.data.limit,
      cursor: params.data.cursor ?? null,
    });
    return jsonSuccess(page, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof InvalidDiscoverUpdatesCursorError) return jsonError("Invalid updates cursor", 400, "BAD_REQUEST");
    logger.warn("discover_updates.read_failed", { scope: query.view, error: error instanceof Error ? error.message : String(error) });
    return jsonError("Updates could not be loaded", 503, "INTERNAL_ERROR");
  }
}
