import { createClient } from "@/lib/supabase/server";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";
import { consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { getTrustedRequestIp } from "@/lib/security/request-ip";
import type { User } from "@supabase/supabase-js";
import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
export { jsonError, jsonSuccess };
export type { ApiErrorCode } from "@/app/api/v1/_envelope";
import type { ApiErrorCode } from "@/app/api/v1/_envelope";

export function getRequestIp(request: Request) {
  return getTrustedRequestIp(request) ?? "unknown";
}

export function getRequestPath(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

export function getRequestId(request: Request) {
  const fromHeader = request.headers.get("x-request-id")?.trim();
  if (fromHeader) return fromHeader;
  return crypto.randomUUID();
}

export function logApiRoute(
  request: Request,
  input: {
    requestId: string;
    action: string;
    userId?: string | null;
    startedAt: number;
    success: boolean;
    status: number;
    errorCode?: ApiErrorCode;
  },
) {
  logger.info("api.v1.request", {
    requestId: input.requestId,
    route: getRequestPath(request),
    action: input.action,
    userId: input.userId ?? undefined,
    durationMs: Date.now() - input.startedAt,
    status: input.status,
    success: input.success,
    errorCode: input.errorCode ?? null,
    sampleRate: input.success ? 0.02 : 1,
  });
}

export function getSessionIdentifier(
  session: { access_token?: string } | null | undefined,
): string | null {
  return getSessionIdentifierFromSession(session);
}

export async function enforceRouteLimit(
  request: Request,
  key: string,
  limit: number,
  windowSeconds: number,
  route: "default" | "publicRead" | "health" = "default",
  identityKey?: string,
) {
  const identifier = identityKey || getRequestIp(request);
  const rl = await consumeRateLimitForRoute(route, `${key}:${identifier}`, limit, windowSeconds);
  if (!rl.allowed) {
    return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
  }
  return null;
}

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { extensionDeviceSessions, profiles } from "@/lib/db/schema";
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

function normalizeSessionHeader(value: string | null, maxLength = 120) {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

const EXTENSION_LAST_SEEN_INTERVAL_MS = 60_000;

export async function requireAuthenticatedUser() {
  const supabase = await createClient();

  // 1. Check for Bearer token authentication
  let bearerAttempted=false;
  try {
    const headerStore = await headers();
    const authHeader = headerStore.get("authorization")?.trim();
    // Any Bearer scheme, even an empty one, means the caller chose token authentication (SEC-001).
    if (authHeader && /^bearer(\s|$)/i.test(authHeader)) {
      bearerAttempted=true;
      const token = authHeader.substring(6).trim();
      if (token.startsWith("nb_dev_")) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const now = new Date();
        // One bounded read: the session and the profile email together; revocation and expiry are checked on every call.
        const [found] = await db
          .select({ session: extensionDeviceSessions, email: profiles.email, fullName:profiles.fullName,avatarUrl:profiles.avatarUrl,username:profiles.username,deletedAt:profiles.deletedAt })
          .from(extensionDeviceSessions)
          .leftJoin(profiles, eq(profiles.id, extensionDeviceSessions.userId))
          .where(and(
            eq(extensionDeviceSessions.tokenHash, tokenHash),
            isNull(extensionDeviceSessions.revokedAt),
            gt(extensionDeviceSessions.expiresAt, now),
          ))
          .limit(1);
        // An account that scheduled its deletion no longer accepts editor tokens.
        const session = found?.deletedAt ? undefined : found?.session;

        if (session) {
          const extensionVersion = normalizeSessionHeader(headerStore.get("x-extension-version"), 40);
          const editorHost = normalizeSessionHeader(headerStore.get("x-editor-host"), 80);
          const editorName = normalizeSessionHeader(headerStore.get("x-editor-name"), 120);
          const editorPlatform = normalizeSessionHeader(headerStore.get("x-editor-platform"), 80);
          const editorVersion = normalizeSessionHeader(headerStore.get("x-editor-version"), 80);
          const userAgent = normalizeSessionHeader(headerStore.get("user-agent"), 240);
          const updates: Partial<typeof extensionDeviceSessions.$inferInsert> = {};
          if (extensionVersion && session.clientVersion !== extensionVersion) {
            updates.clientVersion = extensionVersion;
          }
          if (editorHost && session.editorHost !== editorHost) {
            updates.editorHost = editorHost;
          }
          if (editorName && session.editorName !== editorName) {
            updates.editorName = editorName;
          }
          if (editorPlatform && session.editorPlatform !== editorPlatform) {
            updates.editorPlatform = editorPlatform;
          }
          if (editorVersion && session.editorVersion !== editorVersion) {
            updates.editorVersion = editorVersion;
          }
          if (userAgent && session.userAgent !== userAgent) {
            updates.userAgent = userAgent;
          }

          // lastSeenAt is a presence hint, not an authorization input: refresh it at most once per
          // interval, but always persist changed client metadata. Failures are observed, never fatal.
          const seenIsStale = now.getTime() - session.lastSeenAt.getTime() > EXTENSION_LAST_SEEN_INTERVAL_MS;
          if (seenIsStale || Object.keys(updates).length > 0) {
            void db
              .update(extensionDeviceSessions)
              .set({ ...updates, lastSeenAt: now })
              .where(eq(extensionDeviceSessions.id, session.id))
              .catch((error: unknown) => logger.warn("api.v1.shared.extension_last_seen_failed", {
                module: "api",
                error: error instanceof Error ? error.message : String(error),
              }));
          }

          const mockUser: User = {
            id: session.userId,
            email: found?.email || "",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {full_name:found?.fullName,avatar_url:found?.avatarUrl,username:found?.username},
            identities: [],
            factors: [],
            created_at: session.createdAt.toISOString(),
            updated_at: session.lastSeenAt.toISOString(),
          } as any;

          return { supabase, user: mockUser, extensionSessionId: session.id, response: null };
        }
      }
      return {supabase,user:null,extensionSessionId:null,response:jsonError("Invalid or expired editor session",401,"UNAUTHORIZED")};
    }
  } catch (error) {
    logger.error("api.v1.shared.bearer_auth_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    if(bearerAttempted)return {supabase,user:null,extensionSessionId:null,response:jsonError("Editor session verification failed",401,"UNAUTHORIZED")};
  }

  // 2. Fall back to standard session cookie check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null as User | null,
      extensionSessionId: null as string | null,
      response: jsonError("Sign in to continue", 401, "UNAUTHORIZED"),
    };
  }
  return {
    supabase,
    user,
    extensionSessionId: null as string | null,
    response: null as ReturnType<typeof jsonError> | null,
  };
}

export async function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithBoundedRetry(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; maxAttempts?: number } = {},
) {
  const timeoutMs = Math.max(250, init.timeoutMs ?? 4_000);
  const maxAttempts = Math.max(1, Math.min(3, init.maxAttempts ?? 2));
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(
        (signal) =>
          fetch(input, {
            ...init,
            signal,
          }),
        timeoutMs,
      );

      if (response.ok || !retryableStatuses.has(response.status) || attempt >= maxAttempts) {
        return response;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * attempt, 1_500)));
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * attempt, 1_500)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("fetchWithBoundedRetry failed");
}
