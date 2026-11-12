import { z } from "zod";

import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { pollDeviceCode } from "@/lib/extension/device-codes";
import { deviceTokenSchema } from "@/lib/api/v1-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSRF exemption: no cookies; the caller proves itself with the 256-bit device code only the terminal holds.
const csrfProtection = "device-code-bearer" as const;
void csrfProtection;

/**
 * The terminal polls every few seconds (report A3.1): pending, slow_down, denied, expired, or approved with the
 * token, which is given out once.
 */
export async function POST(request: Request) {
  const limited = await enforceRouteLimit(request, "api:v1:device:token", 60, 60);
  if (limited) return limited;
  try {
    const parsed = deviceTokenSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid sign-in code", 400, "BAD_REQUEST");
    const result = await pollDeviceCode(parsed.data.deviceCode, new Date(), parsed.data.renew);
    if (result.status === "denied") return jsonError("Sign-in was denied in the browser", 403, "FORBIDDEN", { status: "denied" });
    if (result.status === "expired") return jsonError("This sign-in code has expired or was already used", 410, "EXPIRED", { status: "expired" });
    return jsonSuccess(result.status === "approved"
      ? { status: "approved", token: result.token, tokenType: result.tokenType, workspaceId: result.workspaceId, expiresAt: result.expiresAt.toISOString() }
      : { status: result.status }, undefined, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/device/token", fallback: "Couldn’t check sign-in" });
  }
}
