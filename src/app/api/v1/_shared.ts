import { createClient } from "@/lib/supabase/server";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";
import { consumeRateLimit, consumeRateLimitForRoute } from "@/lib/security/rate-limit";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { logger } from "@/lib/logger";
import { getIsolationScope } from "@sentry/nextjs";
import { workspaceAgentPolicy } from "@/lib/agents/policy";
import { consumeOnceGrant, requestAccess } from "@/lib/agents/access-requests";
import { queueSecurityEmail } from "@/lib/email/security-queue";

const AGENT_DAILY_WRITES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_REAPPROVE_MS = 90 * DAY_MS;
const DEVICE_LIFE_MS = 90 * DAY_MS;
const EXTEND_WHEN_LEFT_MS = 30 * DAY_MS;
const MAX_DEVICE_LIFE_MS = 365 * DAY_MS;
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
  route: "default" | "publicRead" | "health" | "signedInRead" = "default",
  identityKey?: string,
) {
  const identifier = identityKey || getRequestIp(request);
  const rl = await consumeRateLimitForRoute(route, `${key}:${identifier}`, limit, windowSeconds);
  if (!rl.allowed) {
    return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
  }
  return null;
}

/** A limiter outage shouldn't stop signed-in people reading files they may open. Signed-out reads stay blocked. */
export function enforceFileReadLimit(request: Request, key: string, limit: number, windowSeconds: number, userId?: string | null) {
  return enforceRouteLimit(request, key, limit, windowSeconds, userId ? "signedInRead" : "default", userId ?? undefined);
}

/** One budget for saving files anywhere in the app. The app checks before it saves, so the check runs out first. */
export function enforceDownloadLimit(request: Request, userId?: string | null) {
  const head = request.method === "HEAD";
  return enforceFileReadLimit(request, head ? "files:download-check" : "files:download", head ? 60 : 120, 60, userId);
}

import { headers } from "next/headers";
import { db } from "@/lib/db";
import { extensionDeviceSessions, personalAccessTokens, profiles, tasks, workspaces } from "@/lib/db/schema";
import crypto from "crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  checkTokenAccess,
  effectiveScopes,
  workspaceRefInRequest,
  OUTSIDE_WORKSPACE_MESSAGE,
  TRUSTED_METHOD_HEADER,
  TRUSTED_TARGET_HEADER,
  type TokenScope,
} from "@/lib/security/token-access";

function normalizeSessionHeader(value: string | null, maxLength = 120) {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

const EXTENSION_LAST_SEEN_INTERVAL_MS = 60_000;
function deniedPrincipal(response: ReturnType<typeof jsonError>) {
  return {
    supabase: null as unknown as Awaited<ReturnType<typeof createClient>>,
    user: null as User | null,
    extensionSessionId: null as string | null,
    tokenScopes: null as Set<TokenScope> | null,
    tokenWorkspaceId: null as string | null,
    tokenAllWorkspaces: false,
    tokenKind: null as "device" | "agent" | "pat" | null,
    response: response as ReturnType<typeof jsonError> | null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An agent's request into one workspace: refused when the workspace paused agents or its organization turned them
 * off (report A5, A7). Runs for every agent request whose workspace is known, so "All my workspaces" agents are
 * checked per request, not once at sign-in.
 */
export async function agentPolicyDenial(workspaceId: string) {
  const { paused, orgAllowsAgents, orgTitle } = await workspaceAgentPolicy(workspaceId);
  if (paused) return jsonError("Agents are paused in this workspace. Its owner can turn them back on in workspace settings.", 403, "AGENTS_PAUSED");
  if (!orgAllowsAgents) return jsonError(`${orgTitle ?? "This organization"} doesn't allow AI agents. Its admins can allow them in organization settings.`, 403, "AGENT_NOT_ALLOWED");
  return null;
}

/** A workspace named in a request as an id or a slug, as an id (null when there's no such workspace). */
async function workspaceIdFromRef(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  if (UUID_RE.test(ref)) return ref;
  const [row] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, ref)).limit(1);
  return row?.id ?? null;
}

/**
 * A signed-in token principal, or a 403 when the token may not call this route or lacks the scope
 * (report A3.6, A3.7). Method and path come from headers the proxy overwrites on every request.
 */
async function bearerPrincipal(
  headerStore: Awaited<ReturnType<typeof headers>>,
  user: User,
  extensionSessionId: string,
  scopes: Set<TokenScope>,
  workspaceId: string | null,
  kind: "device" | "agent" | "pat",
  agentName: string | null = null,
  allWorkspaces = false,
) {
  const target = headerStore.get(TRUSTED_TARGET_HEADER);
  // Errors and logs from this request say which client, token type and agent made it (report A2.13).
  const client = normalizeSessionHeader(headerStore.get("x-nb-client"), 40) ?? normalizeSessionHeader(headerStore.get("x-extension-version"), 40);
  getIsolationScope().setTags({ "nb.token": kind, "nb.via": kind === "agent" ? "agent" : "cli", ...(client ? { "nb.client": client } : {}), ...(agentName ? { "nb.agent": agentName.slice(0, 60) } : {}) });
  let personAgreed = false;
  const denial = checkTokenAccess({ method: headerStore.get(TRUSTED_METHOD_HEADER), path: target, scopes, workspaceId, allWorkspacesAgent: kind === "agent" && allWorkspaces });
  if (denial) {
    logger.warn("api.v1.token_route_denied", {
      path: target?.split("?")[0] ?? null,
      requestId: headerStore.get("x-request-id") ?? undefined,
      via: kind === "agent" ? "agent" : "cli",
      agent: agentName,
      client,
      errorCode: denial.errorCode,
      scope: denial.scope ?? null,
    });
    // An agent missing a permission asks the person instead of just failing (report A5 "Asking for more").
    const asked = kind === "agent" && denial.errorCode === "SCOPE_MISSING" && denial.scope
      ? await askForScope(headerStore, { userId: user.id, sessionId: extensionSessionId, agentName }, denial.scope)
      : undefined;
    if (asked) return deniedPrincipal(asked);
    if (asked === undefined) return deniedPrincipal(jsonError(denial.message, 403, denial.errorCode, denial.scope ? { scope: denial.scope } : undefined));
    // "Allow once" covered it: this one request has the permission, and the person's answer was their yes.
    scopes = new Set([...scopes, denial.scope as TokenScope]);
    personAgreed = true;
  }
  // One abuse budget per token for every token route (report A12.3, finding 76); routes keep their own limits too.
  const isRead = ["GET", "HEAD", "OPTIONS"].includes((headerStore.get(TRUSTED_METHOD_HEADER) ?? "").toUpperCase());
  if (kind === "agent") {
    // "Pause agents" and an organization's "no agents" stop every agent request into that workspace (report §18.5,
    // A8.8). A one-workspace agent is checked against its workspace; an all-workspaces agent against the workspace
    // this request names in its path or query. Routes that take the workspace from the body or a task check it in
    // denyOutsideTokenWorkspace.
    const requestWorkspace = workspaceId ?? (allWorkspaces ? await workspaceIdFromRef(workspaceRefInRequest(target)) : null);
    const policy = requestWorkspace ? await agentPolicyDenial(requestWorkspace) : null;
    if (policy) return deniedPrincipal(policy);
    // A day's writes per agent token (report §18.5, finding 76): enough for real work, not for a runaway loop.
    if (!isRead && !(await consumeRateLimit(`api:v1:agent:day:${extensionSessionId}`, AGENT_DAILY_WRITES, 86_400)).allowed) {
      const limited = jsonError(`This agent made ${AGENT_DAILY_WRITES} changes today, the daily limit. It can continue tomorrow.`, 429, "RATE_LIMITED");
      limited.headers.set("Retry-After", "3600");
      return deniedPrincipal(limited);
    }
  }
  const budget = await consumeRateLimit(`api:v1:token:${isRead ? "read" : "write"}:${extensionSessionId}`, isRead ? 300 : 60, 60);
  if (!budget.allowed) {
    const limited = jsonError("Too many requests from this token. Try again in a minute.", 429, "RATE_LIMITED");
    limited.headers.set("Retry-After", "60");
    return deniedPrincipal(limited);
  }
  return {
    supabase: null as unknown as Awaited<ReturnType<typeof createClient>>,
    user: user as User | null,
    extensionSessionId: extensionSessionId as string | null,
    tokenScopes: scopes as Set<TokenScope> | null,
    /** Set for agent tokens and workspace PATs: the only workspace this token may reach. */
    tokenWorkspaceId: workspaceId as string | null,
    /** An agent approved for "All my workspaces" (0082): tokenWorkspaceId is null and every request is checked. */
    tokenAllWorkspaces: kind === "agent" && allWorkspaces,
    tokenKind: kind as "device" | "agent" | "pat" | null,
    tokenAgentName: agentName,
    /** The person answered "Allow once" for this request; the agent gate takes it as their yes. */
    tokenPersonAgreed: personAgreed,
    response: null as ReturnType<typeof jsonError> | null,
  };
}

/**
 * Keeps a token tied to one workspace inside it, for routes whose workspace comes from the body or from a task
 * (TOKEN_ROUTES `agent: "route"`; tests/unit/token-route-coverage checks every such route calls this).
 */
export async function denyOutsideTokenWorkspace(
  auth: { tokenWorkspaceId?: string | null; tokenAllWorkspaces?: boolean },
  ids: { projectId?: string | null; taskId?: string | null },
) {
  const bound = auth.tokenWorkspaceId;
  if (!bound) {
    // An all-workspaces agent: the workspace this request touches must still allow agents (report A5).
    if (!auth.tokenAllWorkspaces) return null;
    let target = ids.projectId ? await workspaceIdFromRef(ids.projectId) : null;
    if (!target && ids.taskId && UUID_RE.test(ids.taskId)) {
      const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, ids.taskId)).limit(1);
      target = task?.projectId ?? null;
    }
    return target ? agentPolicyDenial(target) : null;
  }
  const outside = () => jsonError(OUTSIDE_WORKSPACE_MESSAGE, 403, "WORKSPACE_NOT_ALLOWED");
  if (ids.projectId && ids.projectId.toLowerCase() !== bound.toLowerCase()) return outside();
  if (ids.taskId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ids.taskId)) {
    const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, ids.taskId)).limit(1);
    if (task && task.projectId !== bound) return outside();
  } else if (ids.taskId && !ids.projectId) {
    // A task number means nothing without its workspace.
    return outside();
  }
  return null;
}

/**
 * An agent token lacks `scope`: null when the person's "Allow once" covers this exact request (header
 * X-NB-Access-Request), else the answer to send: ACCESS_REQUESTED (asked in their inbox), ACCESS_DENIED_BY_PERSON
 * (they said no in the last 24 hours) or SCOPE_MISSING (3 requests already waiting). Report A5, A10.
 */
async function askForScope(
  headerStore: Awaited<ReturnType<typeof headers>>,
  agent: { userId: string; sessionId: string; agentName: string | null },
  scope: TokenScope,
) {
  const method = (headerStore.get(TRUSTED_METHOD_HEADER) ?? "").toUpperCase();
  const path = (headerStore.get(TRUSTED_TARGET_HEADER) ?? "").split("?")[0]!;
  const requestId = headerStore.get("x-nb-access-request")?.trim() || null;
  if (await consumeOnceGrant({ sessionId: agent.sessionId, scope, method, path, requestId })) return null;
  const asked = await requestAccess({ sessionId: agent.sessionId, userId: agent.userId, scope, method, path, agentName: agent.agentName });
  if ("requestId" in asked) {
    return jsonError(`This agent needs the ${scope} permission, so it asked you in NetworkBase. Once you answer, it can try again.`, 403, "ACCESS_REQUESTED", { requestId: asked.requestId, scope });
  }
  if (asked.blocked === "said_no") {
    const denied = jsonError(`The person said no to ${scope} for this agent. It won't ask again for 24 hours.`, 403, "ACCESS_DENIED_BY_PERSON", { scope, retryAfter: asked.retryAfterSeconds ?? 86_400 });
    denied.headers.set("Retry-After", String(asked.retryAfterSeconds ?? 86_400));
    return denied;
  }
  return jsonError(`This token can't do that: it needs the ${scope} permission, and 3 requests are already waiting for the person's answer`, 403, "SCOPE_MISSING", { scope });
}

/** For checks that depend on the request body (finishing a task, approving, final files): 403 when a token lacks the scope. */
export async function requireTokenScope(
  auth: { tokenScopes?: Set<TokenScope> | null; tokenKind?: string | null; extensionSessionId?: string | null; user?: User | null; tokenAgentName?: string | null; tokenPersonAgreed?: boolean },
  scope: TokenScope,
) {
  if (!auth.tokenScopes || auth.tokenScopes.has(scope)) return null;
  if (auth.tokenKind === "agent" && auth.extensionSessionId && auth.user) {
    const answer = await askForScope(await headers(), { userId: auth.user.id, sessionId: auth.extensionSessionId, agentName: auth.tokenAgentName ?? null }, scope);
    if (!answer) auth.tokenPersonAgreed = true;
    return answer;
  }
  return jsonError(`This token can't do that: it needs the ${scope} permission`, 403, "SCOPE_MISSING", { scope });
}

export async function requireAuthenticatedUser() {
  // 1. Check for Bearer token authentication BEFORE initializing cookie store
  let bearerAttempted = false;
  try {
    const headerStore = await headers();
    const authHeader = headerStore.get("authorization")?.trim();
    // Any Bearer scheme, even an empty one, means the caller chose token authentication (SEC-001).
    if (authHeader && /^bearer(\s|$)/i.test(authHeader)) {
      bearerAttempted = true;
      const token = authHeader.substring(6).trim();
      if (token.startsWith("nb_dev_") || token.startsWith("nb_agt_") || token.startsWith("nb_pat_")) {
        // No in-process cache: every request reads revocation and expiry, so revoking a token works at once
        // on every server (API-009; a 15 s cache added with CLI 1.0 broke this, finding 43).
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

        const now = new Date();
        if (token.startsWith("nb_dev_") || token.startsWith("nb_agt_")) {
          // One bounded read: the session and the profile email together; revocation and expiry are checked on every call.
          const [found] = await db
            .select({
              session: extensionDeviceSessions,
              email: profiles.email,
              fullName: profiles.fullName,
              avatarUrl: profiles.avatarUrl,
              username: profiles.username,
              deletedAt: profiles.deletedAt,
            })
            .from(extensionDeviceSessions)
            .leftJoin(profiles, eq(profiles.id, extensionDeviceSessions.userId))
            .where(
              and(
                eq(extensionDeviceSessions.tokenHash, tokenHash),
                isNull(extensionDeviceSessions.revokedAt),
                gt(extensionDeviceSessions.expiresAt, now),
              ),
            )
            .limit(1);
          // An account that scheduled its deletion no longer accepts editor tokens; the prefix must match the
          // token's type, so a device token can't be presented as an agent one or the other way round.
          const session = found?.deletedAt || (found?.session.tokenType === "agent") !== token.startsWith("nb_agt_") ? undefined : found?.session;
          // A sign-in nobody used for 90 days has to be approved again (report A3.10 item 2).
          if (session && now.getTime() - session.lastSeenAt.getTime() > IDLE_REAPPROVE_MS) {
            return deniedPrincipal(jsonError("This sign-in wasn't used for 90 days. Sign in again: nb login", 401, "UNAUTHORIZED"));
          }

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

            const clientChanged = Object.keys(updates).length > 0;
            // Device tokens last 90 days and extend while used, up to a year from approval (report A3.3).
            if (session.tokenType === "device" && session.expiresAt.getTime() - now.getTime() < EXTEND_WHEN_LEFT_MS) {
              const cap = session.createdAt.getTime() + MAX_DEVICE_LIFE_MS;
              const next = Math.min(now.getTime() + DEVICE_LIFE_MS, cap);
              if (next > session.expiresAt.getTime()) updates.expiresAt = new Date(next);
            }
            // Used from a country this token hasn't been used from: tell its owner (report A3.10 item 1). Not a block.
            const country = normalizeSessionHeader(headerStore.get("cf-ipcountry"), 2)?.toUpperCase() ?? null;
            if (country && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== session.lastCountry) {
              updates.lastCountry = country;
              if (session.lastCountry) {
                void queueSecurityEmail(session.userId, "security_new_sign_in", {
                  detail: `${session.tokenType === "agent" ? session.agentName ?? "an AI agent" : "the NetworkBase CLI or an editor"} on ${session.deviceName}, from a new country (${country})`,
                });
              }
            }

            // lastSeenAt is a presence hint, not an authorization input: refresh it at most once per
            // interval, but always persist changed client metadata. Failures are observed, never fatal.
            const seenIsStale = now.getTime() - session.lastSeenAt.getTime() > EXTENSION_LAST_SEEN_INTERVAL_MS;
            if (seenIsStale || Object.keys(updates).length > 0) {
              void db
                .update(extensionDeviceSessions)
                .set({ ...updates, ...(seenIsStale || clientChanged ? { lastSeenAt: now } : {}) })
                .where(eq(extensionDeviceSessions.id, session.id))
                .catch((error: unknown) =>
                  logger.warn("api.v1.shared.extension_last_seen_failed", {
                    module: "api",
                    error: error instanceof Error ? error.message : String(error),
                  }),
                );
            }

            const mockUser: User = {
              id: session.userId,
              email: found?.email || "",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {
                full_name: found?.fullName,
                avatar_url: found?.avatarUrl,
                username: found?.username,
              },
              identities: [],
              factors: [],
              created_at: session.createdAt.toISOString(),
              updated_at: session.lastSeenAt.toISOString(),
            } as any;

            const scopes = effectiveScopes(session.tokenType === "agent" ? "agent" : "device", session.scopes);
            // An agent has a workspace or was approved for all of them (DB check, 0082); anything else is refused.
            if (session.tokenType === "agent" && !session.workspaceId && !session.allWorkspaces) return deniedPrincipal(jsonError("Invalid token", 401, "UNAUTHORIZED"));
            return bearerPrincipal(headerStore, mockUser, session.id, scopes, session.workspaceId ?? null, session.tokenType === "agent" ? "agent" : "device", session.agentName ?? null, session.tokenType === "agent" && session.allWorkspaces);
          }
        } else if (token.startsWith("nb_pat_")) {
          const [found] = await db
            .select({
              pat: personalAccessTokens,
              email: profiles.email,
              fullName: profiles.fullName,
              avatarUrl: profiles.avatarUrl,
              username: profiles.username,
              deletedAt: profiles.deletedAt,
            })
            .from(personalAccessTokens)
            .leftJoin(profiles, eq(profiles.id, personalAccessTokens.userId))
            .where(
              and(
                eq(personalAccessTokens.tokenHash, tokenHash),
                isNull(personalAccessTokens.revokedAt),
                or(
                  isNull(personalAccessTokens.expiresAt),
                  gt(personalAccessTokens.expiresAt, now),
                ),
              ),
            )
            .limit(1);

          const pat = found?.deletedAt ? undefined : found?.pat;
          if (pat) {
            const seenIsStale =
              !pat.lastUsedAt ||
              now.getTime() - pat.lastUsedAt.getTime() > EXTENSION_LAST_SEEN_INTERVAL_MS;
            if (seenIsStale) {
              void db
                .update(personalAccessTokens)
                .set({ lastUsedAt: now })
                .where(eq(personalAccessTokens.id, pat.id))
                .catch(() => {});
            }

            const mockUser: User = {
              id: pat.userId,
              email: found?.email || "",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: { scopes: pat.scopes },
              user_metadata: {
                full_name: found?.fullName,
                avatar_url: found?.avatarUrl,
                username: found?.username,
              },
              identities: [],
              factors: [],
              created_at: pat.createdAt.toISOString(),
              updated_at: (pat.lastUsedAt ?? pat.createdAt).toISOString(),
            } as any;

            const scopes = effectiveScopes("pat", pat.scopes);
            return bearerPrincipal(headerStore, mockUser, pat.id, scopes, pat.workspaceId ?? null, "pat");
          }
        }
      }
      return {
        supabase: null as unknown as Awaited<ReturnType<typeof createClient>>,
        user: null,
        extensionSessionId: null,
        tokenScopes: null,
        tokenWorkspaceId: null,
        tokenAllWorkspaces: false,
        tokenKind: null,
        response: jsonError("Invalid or expired editor session", 401, "UNAUTHORIZED"),
      };
    }
  } catch (error) {
    logger.error("api.v1.shared.bearer_auth_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (bearerAttempted)
      return {
        supabase: null as unknown as Awaited<ReturnType<typeof createClient>>,
        user: null,
        extensionSessionId: null,
        tokenScopes: null,
        tokenWorkspaceId: null,
        tokenAllWorkspaces: false,
        tokenKind: null,
        response: jsonError("Editor session verification failed", 401, "UNAUTHORIZED"),
      };
  }

  // 2. Fall back to standard session cookie check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase,
      user: null as User | null,
      extensionSessionId: null as string | null,
      tokenScopes: null as Set<TokenScope> | null,
      tokenWorkspaceId: null as string | null,
      tokenAllWorkspaces: false,
      tokenKind: null as "device" | "agent" | "pat" | null,
      response: jsonError("Sign in to continue", 401, "UNAUTHORIZED"),
    };
  }
  return {
    supabase,
    user,
    extensionSessionId: null as string | null,
    tokenScopes: null as Set<TokenScope> | null,
    tokenWorkspaceId: null as string | null,
    tokenAllWorkspaces: false,
    tokenKind: null as "device" | "agent" | "pat" | null,
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

/**
 * Retried token writes happen once (report A2.4, finding 72), using the existing route wrapper
 * (`withIdempotentRoute`). The key is scoped to the caller's credential and the exact body, so the same
 * key with a different body runs as a new request instead of replaying the wrong answer. The handler
 * gets a fresh Request with the same body, so it reads it as before.
 */
export async function idempotentWrite(
  request: Request,
  namespace: string,
  handler: (request: Request) => Promise<Response>,
  options: { required?: boolean } = {},
) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key && options.required) {
    return jsonError("Send an Idempotency-Key header so a retry can't write twice", 400, "BAD_REQUEST");
  }
  if (!key) return handler(request);
  if (key.length > 200) return jsonError("Idempotency-Key must be at most 200 characters", 400, "BAD_REQUEST");
  const raw = await request.text();
  const credential = request.headers.get("authorization") ?? request.headers.get("cookie") ?? "";
  const scopeId = crypto.createHash("sha256").update(`${credential}\n${raw}`).digest("hex");
  const replayable = new Request(request.url, { method: request.method, headers: request.headers, body: raw });
  return withIdempotentRoute(request, { namespace, scopeId }, () => handler(replayable));
}
