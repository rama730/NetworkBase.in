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
export type TokenKind = "device" | "pat" | "agent";

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

/** Agents (Claude Code, Codex…) get reads and small writes; more only when the person ticks it at /device (A3.3, §26.6). */
export const AGENT_BASE_SCOPES: TokenScope[] = ["workspace:read", "task:read", "task:write", "file:read", "file:write"];
export const AGENT_EXTRA_SCOPES: TokenScope[] = ["task:complete", "file:final", "doc:write"];

export function effectiveScopes(kind: TokenKind, stored: unknown): Set<TokenScope> {
  const listed = Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  if (listed.length === 0) {
    if (kind === "device") return new Set(DEVICE_DEFAULT);
    if (kind === "agent") return new Set(AGENT_BASE_SCOPES);
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
  /**
   * How a token tied to one workspace (agent tokens, workspace PATs) is kept inside it. Without this, such tokens
   * are refused here (fail closed).
   * - path: the workspace id is the segment after /workspaces/ or /projects/; checked here.
   * - query: the workspace id is the projectId (or workspaceId) query parameter; checked here.
   * - route: the id is in the body or comes from a task; the route calls denyOutsideTokenWorkspace (unit-tested).
   * - self: not about one workspace (me, session), or the route limits its answer to the token's workspace.
   */
  agent?: "path" | "query" | "route" | "self";
};

const ID = "[^/]+";
const route = (path: string) => new RegExp(`^${path}/?$`);

/** Every route a token may call. Body-dependent checks (done, approve, final files) happen in the route via requireTokenScope. */
export const TOKEN_ROUTES: RouteRule[] = [
  // Signing in and out: the token's own session.
  { pattern: route("/api/v1/extension/session"), read: null, write: null, agent: "self" },
  { pattern: route("/api/v1/extension/auth-code"), write: null },
  { pattern: route("/api/v1/extension/heartbeat"), write: "workspace:read" },
  // Workspaces and search.
  { pattern: route("/api/v1/extension/workspaces"), read: "workspace:read", agent: "self" },
  { pattern: route("/api/v1/extension/search"), read: "workspace:read", agent: "query" },
  { pattern: route("/api/v1/extension/(workspace|workspace-summary|project-summary|search-content)"), read: "workspace:read" },
  // Tasks.
  { pattern: route("/api/v1/extension/workspace-tasks"), read: "task:read", agent: "query" },
  { pattern: route("/api/v1/extension/task-detail"), read: "task:read", agent: "route" },
  { pattern: route("/api/v1/extension/project-tasks"), read: "task:read" },
  { pattern: route("/api/v1/extension/(create-task|task-subtask|task-update)"), write: "task:write", agent: "route" },
  { pattern: route("/api/v1/extension/comments"), read: "task:read", write: "task:write", agent: "route" },
  // Files.
  { pattern: route("/api/v1/extension/file"), read: "file:read", write: "file:write", agent: "query" },
  { pattern: route("/api/v1/extension/(file-history|folder|operation|recovery-drafts)"), read: "file:read", write: "file:write" },
  { pattern: route("/api/v1/extension/(fast-push|bulk-intent|bulk-finalize|file-operation)"), write: "file:write", agent: "route" },
  { pattern: route("/api/v1/extension/(pre-push|file-upload|file-lock|recovery-sessions|task-push)"), write: "file:write" },
  { pattern: route(`/api/v1/files/${ID}/(lock|lock-renew)`), write: "file:write" },
  { pattern: route("/api/v1/files/locks"), read: "file:read" },
  { pattern: route(`/api/v1/uploads/${ID}`), read: "file:read", write: "file:write" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/(capabilities|members)`), read: "workspace:read", agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/sync-diff`), read: "file:read" },
  { pattern: route("/api/v1/files/place"), write: "file:write", agent: "route" },
  { pattern: route("/api/v1/me"), read: null, agent: "self" },
  { pattern: route("/api/v1/tasks/count"), read: "task:read", agent: "self" },
  { pattern: route(`/api/v1/workspaces/${ID}/docs`), read: "workspace:read", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/docs/${ID}`), read: "workspace:read", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/manifest`), read: "file:read", agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/image`), read: "workspace:read" },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function tokenRouteRule(path: string) {
  const clean = path.split("?")[0] ?? path;
  return TOKEN_ROUTES.find((r) => r.pattern.test(clean));
}

/** The scope a token needs for this request, null if none, or "forbidden" if tokens may not call it. */
export function tokenRouteScope(method: string, path: string): TokenScope | null | "forbidden" {
  const rule = tokenRouteRule(path);
  if (!rule) return "forbidden";
  const needed = READ_METHODS.has(method.toUpperCase()) ? rule.read : rule.write;
  return needed === undefined ? "forbidden" : needed;
}

type TokenAccessDenial = { status: 403; errorCode: "FORBIDDEN" | "SCOPE_MISSING" | "WORKSPACE_NOT_ALLOWED"; message: string; scope?: TokenScope };

export const OUTSIDE_WORKSPACE_MESSAGE = "This token only works in the workspace it was approved for";

/** The workspace a path or query names, for the `path` and `query` modes. */
function workspaceInRequest(mode: "path" | "query", target: string): string | null {
  const [pathname = "", search = ""] = target.split("?");
  if (mode === "path") return /\/api\/v1\/(?:workspaces|projects)\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const params = new URLSearchParams(search);
  return params.get("projectId") ?? params.get("workspaceId");
}

/** Decide whether a token request may proceed. `method`/`path` come from the proxy's trusted headers. */
export function checkTokenAccess(input: { method: string | null; path: string | null; scopes: Set<TokenScope>; workspaceId?: string | null }): TokenAccessDenial | null {
  if (!input.method || !input.path) {
    return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  }
  const needed = tokenRouteScope(input.method, input.path);
  if (needed === "forbidden") return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  if (needed && !input.scopes.has(needed)) {
    return { status: 403, errorCode: "SCOPE_MISSING", message: `This token can't do that: it needs the ${needed} permission`, scope: needed };
  }
  if (input.workspaceId) {
    const mode = tokenRouteRule(input.path)?.agent;
    if (!mode) return { status: 403, errorCode: "WORKSPACE_NOT_ALLOWED", message: `${OUTSIDE_WORKSPACE_MESSAGE}, and can't use this` };
    if ((mode === "path" || mode === "query") && workspaceInRequest(mode, input.path)?.toLowerCase() !== input.workspaceId.toLowerCase()) {
      return { status: 403, errorCode: "WORKSPACE_NOT_ALLOWED", message: OUTSIDE_WORKSPACE_MESSAGE };
    }
  }
  return null;
}
