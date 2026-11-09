import { z } from "zod";

import { enforceRouteLimit, getRequestId, getRequestIp, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { createDeviceCode, DEVICE_CODE_TTL_MS, DEVICE_POLL_INTERVAL_S } from "@/lib/extension/device-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSRF exemption: no cookies are read or set; the code only becomes useful after a signed-in person approves it
// at /device, where the usual protections apply.
const csrfProtection = "no-ambient-authority" as const;
void csrfProtection;

const schema = z.object({
  clientName: z.string().trim().min(1).max(80),
  deviceName: z.string().trim().min(1).max(120),
  clientVersion: z.string().trim().max(40).optional().nullable(),
  platform: z.string().trim().max(40).optional().nullable(),
  type: z.enum(["device", "agent"]).optional(),
  agentName: z.string().trim().max(80).optional().nullable(),
});

/** A terminal without a browser asks for a sign-in code (report A3.1). */
export async function POST(request: Request) {
  const limited = await enforceRouteLimit(request, "api:v1:device:code", 10, 600);
  if (limited) return limited;
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid sign-in request", 400, "BAD_REQUEST");
    const ip = getRequestIp(request);
    const created = await createDeviceCode({ ...parsed.data, ipAddress: ip === "unknown" ? null : ip, userAgent: request.headers.get("user-agent") });
    const origin = resolveAuthBaseUrl({ requestUrl: request.url });
    return jsonSuccess({
      deviceCode: created.deviceCode,
      userCode: created.userCode,
      verificationUri: `${origin}/device`,
      verificationUriComplete: `${origin}/device?code=${encodeURIComponent(created.userCode)}`,
      interval: DEVICE_POLL_INTERVAL_S,
      expiresIn: DEVICE_CODE_TTL_MS / 1000,
    }, undefined, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/device/code", fallback: "Couldn’t start sign-in" });
  }
}
