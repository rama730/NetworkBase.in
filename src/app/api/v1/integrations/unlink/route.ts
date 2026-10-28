import { z } from "zod";

import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { clearGithubAccountHealthCache } from "@/lib/github/account-health";
import { clearGithubImportAccessCookie } from "@/lib/github/import-access-cookie";
import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";
import { validateCsrf } from "@/lib/security/csrf";
import { isFreshlyVerified } from "@/lib/security/fresh-verification";

const schema = z.object({ provider: z.enum(["google", "github"]) });
const LABELS = { google: "Google", github: "GitHub" } as const;

/**
 * Disconnects a sign-in method (Google or GitHub). It needs a fresh verification, refuses to remove the last
 * way to sign in, and tells the person by email.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  if (auth.extensionSessionId) return jsonError("This needs a browser session", 403, "FORBIDDEN");
  const limited = await enforceRouteLimit(request, "api:v1:integrations:unlink", 10, 3600, "default", auth.user.id);
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose Google or GitHub", 400, "BAD_REQUEST");
  const { provider } = parsed.data;

  if (!(await isFreshlyVerified(auth.supabase, auth.user))) {
    return jsonError("Verify this device before disconnecting a sign-in method", 403, "STEP_UP_REQUIRED");
  }

  const { data, error } = await auth.supabase.auth.getUserIdentities();
  if (error) return jsonError("Your sign-in methods could not be loaded. Try again.", 503, "UNAVAILABLE");
  const identities = data?.identities ?? [];
  const target = identities.find((identity) => identity.provider === provider);
  if (!target) return jsonError(`${LABELS[provider]} is not connected`, 409, "CONFLICT");
  // Supabase refuses too, but the person gets a clear reason instead of its message.
  if (identities.length < 2) return jsonError(`Add another way to sign in before disconnecting ${LABELS[provider]}`, 409, "CONFLICT");

  const result = await auth.supabase.auth.unlinkIdentity(target);
  if (result.error) {
    logger.warn("integrations.unlink_failed", { module: "api", userId: auth.user.id, error: result.error.message });
    return jsonError(`${LABELS[provider]} could not be disconnected`, 400, "BAD_REQUEST");
  }

  if (provider === "github") clearGithubAccountHealthCache();
  await recordSecurityEvent({ userId: auth.user.id, eventType: "sign_in_method_unlinked", request, metadata: { provider } }).catch((auditError) =>
    logger.warn("integrations.unlink.audit_failed", { module: "api", userId: auth.user!.id, error: auditError instanceof Error ? auditError.message : String(auditError) }));
  await queueSecurityEmail(auth.user.id, "security_sign_in_method_changed", { detail: `${LABELS[provider]} was disconnected` });

  const response = jsonSuccess({ provider, unlinked: true }, `${LABELS[provider]} disconnected`);
  if (provider === "github") clearGithubImportAccessCookie(response);
  logApiRoute(request, { requestId, action: "integrations.unlink", userId: auth.user.id, startedAt, success: true, status: 200 });
  return response;
}
