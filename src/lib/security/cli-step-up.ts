import "server-only";
/**
 * "Verify it's you" for risky actions from the terminal (report F5, M7): archiving a workspace, exporting it, making a
 * personal access token. In the app it's the step-up cookie, as before. A person's CLI sign-in counts as verified for
 * 10 minutes after they verify on /cli/verify in the browser; agents never do these. Returns the refusal, or null.
 */
import { and, eq, gt, isNull } from "drizzle-orm";

import { jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";
import { oauthIssuer as publicOrigin } from "@/lib/extension/oauth";
import { personStepUp } from "@/lib/security/change-set-step-up";

export const CLI_STEP_UP_MINUTES = 10;

type Auth = { user: { id: string } | null; tokenScopes?: Set<string> | null; tokenKind?: string | null; extensionSessionId?: string | null };

export async function requireStepUp(auth: Auth, request: Request, what: string): Promise<Response | null> {
  if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  if (!auth.tokenScopes) {
    const stepUp = await personStepUp({ user: auth.user, tokenScopes: null });
    return stepUp ? jsonError(`Verify it's you to ${what}`, 403, "STEP_UP_REQUIRED", { stepUp }) : null;
  }
  if (auth.tokenKind !== "device" || !auth.extensionSessionId) return jsonError(`Only a person, from their own sign-in, can ${what}`, 403, "FORBIDDEN");
  const [fresh] = await db.select({ id: extensionDeviceSessions.id }).from(extensionDeviceSessions)
    .where(and(eq(extensionDeviceSessions.id, auth.extensionSessionId), eq(extensionDeviceSessions.userId, auth.user.id), isNull(extensionDeviceSessions.revokedAt), gt(extensionDeviceSessions.stepUpUntil, new Date())))
    .limit(1);
  if (fresh) return null;
  const url = `${publicOrigin(request)}/cli/verify?s=${encodeURIComponent(auth.extensionSessionId)}`;
  return jsonError(`Verify it's you in the browser to ${what}`, 403, "STEP_UP_REQUIRED", { url });
}
