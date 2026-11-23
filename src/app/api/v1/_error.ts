import { jsonError } from "@/app/api/v1/_envelope";
import { minutesRefusal, protectedRefusal } from "@/lib/branches/protected-refusal";
import { isDomainError } from "@/lib/errors/domain";
import { logger } from "@/lib/logger";

/**
 * The one way a route turns a thrown error into a response (API-005): domain errors keep their
 * 403/404/409 meaning and safe message; everything else is logged with its detail and answered with
 * an opaque 500 that carries only the request id for correlation.
 */
export function routeErrorResponse(error: unknown, context: { requestId: string; scope: string; fallback: string }) {
  if (isDomainError(error)) return jsonError(error.message, error.status, error.errorCode);
  // A protected main refused the write at commit (report H5, 0099 saves_guard), whichever route made it.
  const refused = protectedRefusal(error);
  if (refused) return jsonError(refused.message, 403, "BRANCH_PROTECTED" as never, { reason: refused.reason });
  // Approved board minutes refused the write (A4.9, 0117), whichever route made it.
  const minutes = minutesRefusal(error);
  if (minutes) return jsonError(minutes, 403, "FORBIDDEN");
  logger.error(`[${context.scope}] failed`, {
    module: "api",
    requestId: context.requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return jsonError(context.fallback, 500, "INTERNAL_ERROR", { requestId: context.requestId });
}
