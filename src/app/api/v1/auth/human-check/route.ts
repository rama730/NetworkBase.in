import { z } from "zod";
import { enforceRouteLimit, getRequestIp, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { HUMAN_CHECK_ACTIONS, setHumanCheckCookie } from "@/lib/auth/human-check";
import { validateCsrf } from "@/lib/security/csrf";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

const bodySchema = z.object({
  captchaToken: z.string().trim().min(1).max(4096),
  rid: z.string().trim().regex(/^[A-Za-z0-9-]{8,80}$/),
});

/** Before Google or GitHub: Cloudflare's answer becomes a ten-minute pass for this one sign-in attempt. */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const limited = await enforceRouteLimit(request, "api:v1:auth:human-check", 20, 60);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Complete the security check first.", 400, "BAD_REQUEST");

  const check = await verifyTurnstileToken({
    token: parsed.data.captchaToken,
    ip: getRequestIp(request),
    expectedAction: HUMAN_CHECK_ACTIONS,
  });
  if (!check.success) return jsonError("The security check didn’t pass. Wait for a new check, then try again.", 400, "BAD_REQUEST");

  const response = jsonSuccess({ passed: true });
  setHumanCheckCookie(response, parsed.data.rid);
  return response;
}
