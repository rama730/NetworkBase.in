import { z } from "zod";
import { enforceRouteLimit, getRequestIp, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { HUMAN_CHECK_ACTIONS, markHumanChecked } from "@/lib/auth/human-check";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";
import { isTurnstileServerConfigured, verifyTurnstileToken } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  credential: z.string().trim().min(1).max(8192),
  nonce: z.string().trim().min(1).max(512),
  captchaToken: z.string().trim().min(1).max(4096).optional(),
});

/**
 * One Tap's Google credential, exchanged here rather than in the browser: Supabase skips its captcha for this kind
 * of sign-in, so the server asks Cloudflare first and marks a new account as checked.
 */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const limited = await enforceRouteLimit(request, "api:v1:auth:google-one-tap", 20, 60);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Couldn’t complete Google sign-in", 400, "BAD_REQUEST");

  if (isTurnstileServerConfigured()) {
    if (!parsed.data.captchaToken) return jsonError("Complete the security check first.", 400, "BAD_REQUEST");
    const check = await verifyTurnstileToken({
      token: parsed.data.captchaToken,
      ip: getRequestIp(request),
      expectedAction: HUMAN_CHECK_ACTIONS,
    });
    if (!check.success) return jsonError("The security check didn’t pass. Wait for a new check, then try again.", 400, "BAD_REQUEST");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: parsed.data.credential,
    nonce: parsed.data.nonce,
  });
  if (error || !data.session || !data.user) return jsonError("Couldn’t complete Google sign-in", 400, "BAD_REQUEST");

  if (isTurnstileServerConfigured() && !(await markHumanChecked(data.user))) {
    logger.warn("auth.google_one_tap.mark_failed", { userId: data.user.id });
  }

  return jsonSuccess({
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: typeof data.session.expires_at === "number" ? data.session.expires_at : null,
    },
  });
}
