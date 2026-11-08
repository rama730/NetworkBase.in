import { z } from "zod";
import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { getLegalAcceptanceState, recordCurrentLegalAcceptance } from "@/lib/legal/acceptance";
import { validateCsrf } from "@/lib/security/csrf";
import { hasPassedHumanCheck } from "@/lib/auth/human-check";
import { isTurnstileServerConfigured } from "@/lib/security/turnstile";

const acceptanceSchema = z.object({
  accepted: z.literal(true),
  context: z.enum(["oauth_signup", "settings", "material_update"]),
  ageConfirmed: z.boolean().optional(),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  return jsonSuccess(await getLegalAcceptanceState(auth.user.id));
}
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  // Accepting the terms is the person's own act: an editor token cannot do it for them.
  if (auth.extensionSessionId) return jsonError("Accepting the terms requires a browser session", 403, "FORBIDDEN");
  const limited = await enforceRouteLimit(request, "api:v1:legal:acceptance", 20, 3600, "default", auth.user.id);
  if (limited) return limited;
  const parsed = acceptanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Explicit acceptance is required", 400, "BAD_REQUEST");
  // A first acceptance is where a new account becomes a profile. Google and GitHub accounts get there only after the
  // sign-in page's Cloudflare check, so one made by going around the page stops here. Updated terms are never blocked.
  if (isTurnstileServerConfigured() && !hasPassedHumanCheck(auth.user)) {
    const state = await getLegalAcceptanceState(auth.user.id);
    if (!state.latest) {
      return jsonError("Sign in again from the sign-in page to finish the security check.", 403, "FORBIDDEN");
    }
  }
  await recordCurrentLegalAcceptance({ userId: auth.user.id, request, context: parsed.data.context, ageConfirmed: parsed.data.ageConfirmed });
  return jsonSuccess({ accepted: true, requestId: getRequestId(request) });
}
