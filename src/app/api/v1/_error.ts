import { jsonError } from "@/app/api/v1/_envelope";
import { isDomainError } from "@/lib/errors/domain";
import { logger } from "@/lib/logger";

/**
 * The one way a route turns a thrown error into a response (API-005): domain errors keep their
 * 403/404/409 meaning and safe message; everything else is logged with its detail and answered with
 * an opaque 500 that carries only the request id for correlation.
 */
export function routeErrorResponse(error: unknown, context: { requestId: string; scope: string; fallback: string }) {
  if (isDomainError(error)) return jsonError(error.message, error.status, error.errorCode);
  logger.error(`[${context.scope}] failed`, {
    module: "api",
    requestId: context.requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return jsonError(context.fallback, 500, "INTERNAL_ERROR", { requestId: context.requestId });
}
