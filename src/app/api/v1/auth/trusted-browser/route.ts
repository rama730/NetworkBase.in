import { z } from "zod";
import { NextResponse } from "next/server";
import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { listTrustedDevices, readDeviceCookie, resolveDeviceId, setDeviceCookie, stopTrustingDevices, trustDevice, TRUST_DAYS } from "@/lib/auth/devices";
import { validateCsrf } from "@/lib/security/csrf";
import { createClient } from "@/lib/supabase/server";

/**
 * "Trust this browser for 30 days". GET says whether this browser is signed in past the code step (a trusted browser
 * is, without the code) and, with ?list, lists the trusted browsers for Settings. POST trusts this browser right after
 * the code was entered. DELETE stops trusting one browser, or all of them.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!new URL(request.url).searchParams.has("list")) return jsonSuccess({ signedIn: Boolean(data.user) });
  if (!data.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  return jsonSuccess({ browsers: await listTrustedDevices(data.user.id, readDeviceCookie(request)), days: TRUST_DAYS });
}

export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  if (auth.extensionSessionId) return jsonError("Trusting a browser needs a browser session", 403, "FORBIDDEN");
  const limited = await enforceRouteLimit(request, "api:v1:auth:trusted-browser", 10, 3600, "default", auth.user.id);
  if (limited) return limited;
  // Staff tools need the code every time (the database checks it too), so their browsers are never trusted.
  const role = auth.user.app_metadata?.role;
  if (role === "admin" || role === "moderator") return jsonError("Staff accounts enter the code every time.", 403, "FORBIDDEN");
  const { data: level } = await auth.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") return jsonError("Enter your code first.", 403, "STEP_UP_REQUIRED");

  const { deviceId, isNewCookie } = resolveDeviceId(readDeviceCookie(request));
  await trustDevice(auth.user.id, deviceId, request.headers.get("user-agent"));
  const response = jsonSuccess({ trusted: true, days: TRUST_DAYS });
  if (isNewCookie) setDeviceCookie(response as NextResponse, deviceId);
  return response;
}

const deleteSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export async function DELETE(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Unknown browser", 400, "BAD_REQUEST");
  await stopTrustingDevices(auth.user.id, parsed.data.id);
  return jsonSuccess({ stopped: true });
}
