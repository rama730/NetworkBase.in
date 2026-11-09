import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { enforceRouteLimit, jsonError, jsonSuccess, getRequestIp } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessionEvents, extensionDeviceSessions, personalAccessTokens, profiles } from "@/lib/db/schema";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization")?.trim();
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  // Device, AI agent (both in extension_device_sessions) and personal tokens: an agent can be signed out too.
  return /^nb_(dev|agt|pat)_/.test(token) ? token : null;
}

export async function GET(request: Request) {
  const limitResponse = await enforceRouteLimit(request, "api:v1:extension:session:status", 60, 60);
  if (limitResponse) return limitResponse;

  const token = getBearerToken(request);
  if (!token) {
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  if (token.startsWith("nb_pat_")) {
    const [found] = await db
      .select({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
        expiresAt: personalAccessTokens.expiresAt,
        revokedAt: personalAccessTokens.revokedAt,
        email: profiles.email,
        username: profiles.username,
        fullName: profiles.fullName,
      })
      .from(personalAccessTokens)
      .leftJoin(profiles, eq(profiles.id, personalAccessTokens.userId))
      .where(eq(personalAccessTokens.tokenHash, tokenHash))
      .limit(1);

    if (!found) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const active = !found.revokedAt && (!found.expiresAt || found.expiresAt.getTime() > now);
    const userPayload = active
      ? { id: found.userId, email: found.email, username: found.username, fullName: found.fullName }
      : null;


    return jsonSuccess(
      {
        sessionId: found.id,
        active,
        tokenType: "pat",
        user: userPayload,
      },
      undefined,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [session] = await db
    .select({
      id: extensionDeviceSessions.id,
      userId: extensionDeviceSessions.userId,
      expiresAt: extensionDeviceSessions.expiresAt,
      revokedAt: extensionDeviceSessions.revokedAt,
      email: profiles.email,
      username: profiles.username,
      fullName: profiles.fullName,
    })
    .from(extensionDeviceSessions)
    .leftJoin(profiles, eq(profiles.id, extensionDeviceSessions.userId))
    .where(eq(extensionDeviceSessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }

  const active = !session.revokedAt && session.expiresAt.getTime() > now;
  const userPayload = active
    ? { id: session.userId, email: session.email, username: session.username, fullName: session.fullName }
    : null;


  // Revoked tokens may read only their own liveness so the IDE can erase them after web-side disconnect.
  return jsonSuccess(
    {
      sessionId: session.id,
      active,
      tokenType: "device",
      user: userPayload,
    },
    undefined,
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const limitResponse = await enforceRouteLimit(request, "api:v1:extension:session:revoke", 30, 60);
    if (limitResponse) return limitResponse;

    const token = getBearerToken(request);
    if (!token) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (token.startsWith("nb_pat_")) {
      await db
        .update(personalAccessTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(personalAccessTokens.tokenHash, tokenHash),
            isNull(personalAccessTokens.revokedAt),
          ),
        );
      return jsonSuccess({ revoked: true });
    }

    const session = await db.query.extensionDeviceSessions.findFirst({
      where: eq(extensionDeviceSessions.tokenHash, tokenHash),
    });

    if (!session) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    if (session.revokedAt) {
      return jsonSuccess({ revoked: true });
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(extensionDeviceSessions)
        .set({
          revokedAt: now,
          revocationReason: "extension_disconnect",
        })
        .where(
          and(
            eq(extensionDeviceSessions.id, session.id),
            isNull(extensionDeviceSessions.revokedAt),
          ),
        )
        .returning({ id: extensionDeviceSessions.id });

      if (!revoked) return;

      await tx.insert(extensionDeviceSessionEvents).values({
        sessionId: session.id,
        eventType: EXTENSION_DEVICE_SESSION_EVENTS.revocation,
        ipAddress: getRequestIp(request),
        userAgent: request.headers.get("user-agent")?.trim() || null,
        metadata: { reason: "extension_disconnect" },
        createdAt: now,
      });
    });

    return jsonSuccess({ revoked: true });
  } catch (error) {
    logger.error("[api/v1/extension/session] Failed to revoke extension session", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Couldn’t revoke extension session", 500, "INTERNAL_ERROR");
  }
}
