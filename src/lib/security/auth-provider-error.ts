import type { ApiErrorCode } from "@/app/api/v1/_envelope";

/**
 * One mapping from a Supabase Auth error to an API status and code (API-001, API-005): 4xx provider
 * answers keep their meaning; anything else is an opaque 500 so provider internals never leak.
 */
export function mapAuthProviderError(
  error: { status?: number; code?: string; message?: string },
  fallbackMessage: string,
): { status: number; errorCode: ApiErrorCode; message: string } {
  const status = Number(error.status);
  const code = String(error.code ?? "").toLowerCase();
  if (status === 404 || code.includes("not_found")) return { status: 404, errorCode: "NOT_FOUND", message: "Not found" };
  if (status === 401) return { status: 401, errorCode: "UNAUTHORIZED", message: "Not authenticated" };
  if (status === 403) return { status: 403, errorCode: "FORBIDDEN", message: "Forbidden" };
  if (status >= 400 && status < 500) return { status, errorCode: "BAD_REQUEST", message: error.message || fallbackMessage };
  return { status: 500, errorCode: "INTERNAL_ERROR", message: fallbackMessage };
}
