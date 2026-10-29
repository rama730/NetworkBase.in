import { createHash } from "node:crypto";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { getDiscoverUpdate } from "@/lib/data/discover-updates";
import { logger } from "@/lib/logger";
import { consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import { getViewerAuthContext } from "@/lib/server/viewer-context";

/**
 * One update by id, for a `/discover?updateId=` link. It finds exactly what the feed could show this viewer:
 * an update of a private project, a hidden Updates tab, or a blocked author is "not found", never "forbidden".
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { user } = await getViewerAuthContext();
  const ip = getTrustedRequestIp(request)
    ?? `fp:${createHash("sha1").update(`${request.headers.get("user-agent") ?? ""}|${request.headers.get("accept-language") ?? ""}`).digest("hex").slice(0, 16)}`;
  const limit = await consumeRateLimitForRoute("publicRead", `discover-update:${user?.id ?? `anon:${ip}`}`, 120, 60);
  if (!limit.allowed && !limit.degraded) return jsonError("Too many requests. Please wait a moment and try again.", 429, "RATE_LIMITED");

  try {
    const update = await getDiscoverUpdate(id, user?.id ?? null);
    if (!update) return jsonError("That update isn’t available", 404, "NOT_FOUND");
    return jsonSuccess({ update }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.warn("discover_updates.single_read_failed", { resourceType: "project_update", resourceId: id, error: error instanceof Error ? error.message : String(error) });
    return jsonError("The update could not be loaded", 503, "INTERNAL_ERROR");
  }
}
