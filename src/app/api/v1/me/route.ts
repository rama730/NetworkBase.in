import { eq } from "drizzle-orm";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { agentAccessCard } from "@/lib/agents/access-settings";
import { db } from "@/lib/db";
import { extensionDeviceSessions, personalAccessTokens, profiles } from "@/lib/db/schema";
import { TOKEN_SCOPES } from "@/lib/security/token-access";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in and what this credential may do (report A2.5): `nb whoami`, agent setup and the
 * CLI's pre-upload size check read it, and so does the sign-in welcome flight (which has no browser session yet after
 * a Google or GitHub return, only the cookie). Dates print in the terminal's own time zone, so none is sent.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const [profile] = await db
      .select({ username: profiles.username, fullName: profiles.fullName, email: profiles.email, avatarUrl: profiles.avatarUrl, visibility: profiles.visibility })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1);
    const scopes = auth.tokenScopes ? [...auth.tokenScopes].sort() : [...TOKEN_SCOPES];
    // When this sign-in ends, for nb whoami's sentence (report C16 #7) and the expiry warning (C6).
    const kind = "tokenKind" in auth ? auth.tokenKind : null;
    const id = "extensionSessionId" in auth ? auth.extensionSessionId : null;
    const [ends] = !id ? [] : kind === "pat"
      ? await db.select({ at: personalAccessTokens.expiresAt }).from(personalAccessTokens).where(eq(personalAccessTokens.id, id)).limit(1)
      : await db.select({ at: extensionDeviceSessions.expiresAt }).from(extensionDeviceSessions).where(eq(extensionDeviceSessions.id, id)).limit(1);
    return jsonSuccess(
      {
        user: { id: auth.user.id, username: profile?.username ?? null, fullName: profile?.fullName ?? null, email: profile?.email ?? null, avatarUrl: profile?.avatarUrl ?? null, visibility: profile?.visibility ?? "public" },
        credential: auth.tokenScopes ? { kind: "token", sessionId: auth.extensionSessionId, scopes, type: kind, workspaceId: auth.tokenWorkspaceId, expiresAt: ends?.at?.toISOString() ?? null } : { kind: "browser", scopes },
        limits: { largestFileBytes: WORKSPACE_UPLOAD_MAX_FILE_BYTES },
        /** For agent sign-ins: where, what and how long, in the approval page's words (report A6). */
        access: "tokenKind" in auth && auth.tokenKind === "agent" && auth.extensionSessionId ? await agentAccessCard(auth.extensionSessionId) : null,
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/me", fallback: "Couldn’t read your account" });
  }
}
