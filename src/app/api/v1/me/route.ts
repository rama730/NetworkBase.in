import { eq } from "drizzle-orm";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { TOKEN_SCOPES } from "@/lib/security/token-access";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in and what this credential may do (report A2.5): `nb whoami`, agent setup and the
 * CLI's pre-upload size check read it. Dates print in the terminal's own time zone, so none is sent.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const [profile] = await db
      .select({ username: profiles.username, fullName: profiles.fullName, email: profiles.email, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1);
    const scopes = auth.tokenScopes ? [...auth.tokenScopes].sort() : [...TOKEN_SCOPES];
    return jsonSuccess(
      {
        user: { id: auth.user.id, username: profile?.username ?? null, fullName: profile?.fullName ?? null, email: profile?.email ?? null, avatarUrl: profile?.avatarUrl ?? null },
        credential: auth.tokenScopes ? { kind: "token", sessionId: auth.extensionSessionId, scopes, type: "tokenKind" in auth ? auth.tokenKind : null, workspaceId: auth.tokenWorkspaceId } : { kind: "browser", scopes },
        limits: { largestFileBytes: WORKSPACE_UPLOAD_MAX_FILE_BYTES },
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/me", fallback: "Couldn’t read your account" });
  }
}
