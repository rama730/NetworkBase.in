/**
 * What a bearer token (CLI, editor, agent, CI) may reach (report A3.6, A3.7; findings 29, 30).
 *
 * Tokens are accepted only on the routes listed here, and only with the scope a route needs.
 * Everything else — account, password, MFA, sessions, tokens, privacy, billing — needs a browser
 * session. A new route is refused for tokens until it is listed (tests/unit/token-route-coverage).
 */

/** Set by src/proxy.ts on every request (overwriting anything the client sent); the only trusted source of method and path. */
export const TRUSTED_TARGET_HEADER = "x-networkbase-request-target";
export const TRUSTED_METHOD_HEADER = "x-networkbase-request-method";

export const TOKEN_SCOPES = [
  "workspace:read",
  "task:read",
  "task:write",
  "task:complete",
  "task:review",
  "file:read",
  "file:write",
  "file:final",
  "file:delete",
  "doc:write",
  "assignment:hand-in",
  "ask:others",
] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];
export type TokenKind = "device" | "pat";

const isTokenScope = (value: string): value is TokenScope => (TOKEN_SCOPES as readonly string[]).includes(value);

/**
 * Scopes shown on tokens made before enforcement keep the reach they had (report §42.3):
 * write implies read, and task:write let people finish tasks.
 */
const LEGACY_SCOPES: Record<string, TokenScope[]> = {
  "repo:read": ["workspace:read", "file:read", "task:read"],
  "repo:write": ["workspace:read", "file:read", "file:write", "file:final", "file:delete"],
  "task:write": ["workspace:read", "task:read", "task:write", "task:complete"],
  "sprint:manage": ["workspace:read", "task:read", "task:write"],
};

/** Personal tokens saved without scopes were listed as repo:read + repo:write (actions/personal-access-tokens.ts). */
const PAT_DEFAULT = ["repo:read", "repo:write"];

/** A device token (your own CLI or editor) gets everything except asking other people (report A3.3). */
const DEVICE_DEFAULT = TOKEN_SCOPES.filter((scope) => scope !== "ask:others");

export function effectiveScopes(kind: TokenKind, stored: unknown): Set<TokenScope> {
  const listed = Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  if (listed.length === 0) {
    if (kind === "device") return new Set(DEVICE_DEFAULT);
    return effectiveScopes("pat", PAT_DEFAULT);
  }
  const scopes = new Set<TokenScope>();
  for (const entry of listed) {
    if (LEGACY_SCOPES[entry]) for (const scope of LEGACY_SCOPES[entry]) scopes.add(scope);
    else if (isTokenScope(entry)) scopes.add(entry);
  }
  return scopes;
}

type RouteRule = {
  /** Matches the path without query string. */
  pattern: RegExp;
  /** Scope for GET/HEAD; null = no scope needed; undefined = reads not allowed. */
  read?: TokenScope | null;
  /** Scope for POST/PUT/PATCH/DELETE; null = no scope needed; undefined = writes not allowed. */
  write?: TokenScope | null;
};

const ID = "[^/]+";
const route = (path: string) => new RegExp(`^${path}/?$`);

/** Every route a token may call. Body-dependent checks (done, approve, final files) happen in the route via requireTokenScope. */
export const TOKEN_ROUTES: RouteRule[] = [
  // Signing in and out: the token's own session.
  { pattern: route("/api/v1/extension/session"), read: null, write: null },
  { pattern: route("/api/v1/extension/auth-code"), write: null },
  { pattern: route("/api/v1/extension/heartbeat"), write: "workspace:read" },
  // Workspaces and search.
  { pattern: route("/api/v1/extension/(workspaces|workspace|workspace-summary|project-summary|search|search-content)"), read: "workspace:read" },
  // Tasks.
  { pattern: route("/api/v1/extension/(workspace-tasks|project-tasks|task-detail)"), read: "task:read" },
  { pattern: route("/api/v1/extension/(create-task|task-subtask|task-update)"), write: "task:write" },
  { pattern: route("/api/v1/extension/comments"), read: "task:read", write: "task:write" },
  // Files.
  { pattern: route("/api/v1/extension/(file|file-history|folder|operation|recovery-drafts)"), read: "file:read", write: "file:write" },
  { pattern: route("/api/v1/extension/(fast-push|pre-push|bulk-intent|bulk-finalize|file-upload|file-operation|file-lock|recovery-sessions|task-push)"), write: "file:write" },
  { pattern: route(`/api/v1/files/${ID}/(lock|lock-renew)`), write: "file:write" },
  { pattern: route("/api/v1/files/locks"), read: "file:read" },
  { pattern: route(`/api/v1/uploads/${ID}`), read: "file:read", write: "file:write" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/(capabilities|members)`), read: "workspace:read" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/sync-diff`), read: "file:read" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/image`), read: "workspace:read" },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The scope a token needs for this request, null if none, or "forbidden" if tokens may not call it. */
export function tokenRouteScope(method: string, path: string): TokenScope | null | "forbidden" {
  const clean = path.split("?")[0] ?? path;
  const rule = TOKEN_ROUTES.find((r) => r.pattern.test(clean));
  if (!rule) return "forbidden";
  const needed = READ_METHODS.has(method.toUpperCase()) ? rule.read : rule.write;
  return needed === undefined ? "forbidden" : needed;
}

export type TokenAccessDenial = { status: 403; errorCode: "FORBIDDEN" | "SCOPE_MISSING"; message: string; scope?: TokenScope };

/** Decide whether a token request may proceed. `method`/`path` come from the proxy's trusted headers. */
export function checkTokenAccess(input: { method: string | null; path: string | null; scopes: Set<TokenScope> }): TokenAccessDenial | null {
  if (!input.method || !input.path) {
    return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  }
  const needed = tokenRouteScope(input.method, input.path);
  if (needed === "forbidden") return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  if (needed && !input.scopes.has(needed)) {
    return { status: 403, errorCode: "SCOPE_MISSING", message: `This token can't do that: it needs the ${needed} permission`, scope: needed };
  }
  return null;
}
