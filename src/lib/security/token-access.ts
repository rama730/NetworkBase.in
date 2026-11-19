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
/** A fresh id per request, set by the proxy (any client value is overwritten). */
export const TRUSTED_REQUEST_ID_HEADER = "x-networkbase-request-id";

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
  "message:read",
  "message:write",
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
    // Agent tokens were always stored with the new names, where task:write does not include task:complete.
    if (kind !== "agent" && LEGACY_SCOPES[entry]) for (const scope of LEGACY_SCOPES[entry]) scopes.add(scope);
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
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/capabilities`), read: "workspace:read", agent: "path" },
  // Members (report C4): reading for any token; changes check for the person's own sign-in in the route.
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/members`), read: "workspace:read", write: null, agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/sync-diff`), read: "file:read" },
  { pattern: route("/api/v1/files/place"), write: "file:write", agent: "route" },
  // Change sets (report G7): the workspace is in the path, or comes from the change set (the route checks it).
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/change-sets`), read: "file:read", write: "file:write", agent: "path" },
  { pattern: route(`/api/v1/change-sets/${ID}(/diff)?`), read: "file:read", agent: "route" },
  { pattern: route(`/api/v1/change-sets/${ID}/comments`), read: "file:read", write: "file:write", agent: "route" },
  { pattern: route(`/api/v1/change-sets/${ID}/(items|content|finish|apply|discard|undo|copy|update|resolve)`), write: "file:write", agent: "route" },
  // Files for cloud agents (report G14, routes 14–18).
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/fs/(list|read|search)`), read: "file:read", agent: "path" },
  { pattern: route(`/api/v1/change-sets/${ID}/fs/(edit|write|delete|move)`), write: "file:write", agent: "route" },
  // History (report H3, H14): main's saves, one save, its diffs, files and zip; revert writes like a change set.
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/saves`), read: "file:read", agent: "path" },
  { pattern: route(`/api/v1/saves/${ID}(/(diff|files|zip))?`), read: "file:read", agent: "route" },
  { pattern: route(`/api/v1/saves/${ID}/revert`), write: "file:write", agent: "route" },
  // Branches (report H14): list and create in the workspace; one branch, its files, changes, diffs, bytes and zip;
  // rename, delete, restore and update from main write. The route finds the branch's workspace.
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/branches`), read: "file:read", write: "file:write", agent: "path" },
  { pattern: route(`/api/v1/branches/${ID}`), read: "file:read", write: "file:write", agent: "route" },
  { pattern: route(`/api/v1/branches/${ID}/(files|changes|diff|raw|zip)`), read: "file:read", agent: "route" },
  { pattern: route(`/api/v1/branches/${ID}/(restore|update|use)`), write: "file:write", agent: "route" },
  // Merge requests (report H4, H14): list, open, read, change; reviews (people only), comments, suggestions, checks
  // and merging write like a change set. The number in the path is the workspace's ("!3").
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/merge-requests(/[0-9]+)?`), read: "file:read", write: "file:write", agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/merge-requests/[0-9]+/(reviews|comments|suggestions|checks|merge)`), write: "file:write", agent: "path" },
  // The Branches setting (H16): people only (the route refuses agents), owners and admins.
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/branches-setting`), write: "file:write" },
  // Workspace admin (report F3): create (people), settings, archive (after Verify it's you), docs add and remove.
  { pattern: route("/api/v1/(workspaces|projects)"), read: null, write: "task:write" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/settings`), read: "workspace:read", write: "task:write", agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/archive`), write: "task:write" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/export`), read: "file:read", agent: "path" },
  // Main's protection (H5): everyone reads; owners and admins change it, people only (the route refuses agents).
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/protection`), read: "file:read", write: "file:write", agent: "path" },
  { pattern: route("/api/v1/me"), read: null, agent: "self" },
  // Your security summary (report F5, nb whoami --security): the person's own terminal, never an agent.
  { pattern: route("/api/v1/me/security"), read: "workspace:read" },
  // "My reviews" across workspaces (H23): not for tokens tied to one workspace.
  { pattern: route("/api/v1/me/reviews"), read: "file:read" },
  // Your notification settings (report C4, nb inbox settings and mute): the person's own terminal, not agents.
  { pattern: route("/api/v1/me/notifications"), read: "workspace:read", write: "workspace:read" },
  { pattern: route("/api/v1/tasks/count"), read: "task:read", agent: "self" },
  // nb on its own (report C1): the person's terminal only, since it includes the inbox.
  { pattern: route("/api/v1/home"), read: "task:read" },
  { pattern: route(`/api/v1/workspaces/${ID}/docs`), read: "workspace:read", write: "doc:write", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/docs/${ID}`), read: "workspace:read", write: "doc:write", agent: "path" },
  // A document's live lists (report 38.3 W13, nb docs rows): rows are tasks, so they read and write like tasks.
  { pattern: route(`/api/v1/workspaces/${ID}/docs/${ID}/rows`), read: "task:read", write: "task:write", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/manifest`), read: "file:read", agent: "path" },
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/image`), read: "workspace:read" },
  // One workspace, its activity and sprints, and updates (report A2.5, A8.7, D25).
  { pattern: route(`/api/v1/workspaces/${ID}`), read: "workspace:read", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/activity`), read: "task:read", agent: "path" },
  // Sprints (report F2): read, create; add tasks and close write like tasks.
  { pattern: route(`/api/v1/workspaces/${ID}/sprints`), read: "task:read", write: "task:write", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/sprints/${ID}/${ID}`), write: "task:write", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/updates`), read: "workspace:read", write: "task:write", agent: "path" },
  // One update: read its comments, like it, comment (report C4).
  { pattern: route(`/api/v1/workspaces/${ID}/updates/${ID}`), read: "workspace:read", write: "task:write", agent: "path" },
  // Attach a workspace file to a task, or take it off; the route checks the workspace and final-file permission.
  { pattern: route(`/api/v1/tasks/${ID}/files`), write: "file:write", agent: "route" },
  // Several tasks at once (report C2); the route checks the workspace and asks for task:complete to finish.
  { pattern: route("/api/v1/tasks/bulk"), write: "task:write", agent: "route" },
  // Labels, "blocked by", links, watch and star (report C2, 0087); the route checks the task's workspace.
  { pattern: route(`/api/v1/tasks/${ID}/meta`), read: "task:read", write: "task:write", agent: "route" },
  // Your reminders on a task (report C2, 0088): your own, so reading the task is enough.
  { pattern: route(`/api/v1/tasks/${ID}/reminders`), read: "task:read", write: "task:read", agent: "route" },
  // Agent notes on a task (report D16, 0089): where an agent stopped; writing one is a small task change.
  { pattern: route(`/api/v1/tasks/${ID}/agent-notes`), read: "task:read", write: "task:write", agent: "route" },
  // Who's working on a task (report D5): saying "I'm here" needs the right to change the task.
  { pattern: route(`/api/v1/tasks/${ID}/presence`), read: "task:read", write: "task:write", agent: "route" },
  // nb learn's practice workspace (report C1): a token that can make tasks, never one tied to a workspace (no agent
  // rule, so those are refused here); the routes refuse agents and touch only the person's own sandbox.
  { pattern: route("/api/v1/sandbox"), write: "task:write" },
  { pattern: route(`/api/v1/sandbox/${ID}`), write: "task:write" },
  // Messages (report C4): never for agents (the routes refuse them) and never in an agent preset; no agent rule, so
  // a workspace-bound token is refused here too.
  { pattern: route("/api/v1/chat/conversations"), read: "message:read" },
  { pattern: route(`/api/v1/chat/conversations/${ID}/messages`), read: "message:read", write: "message:write" },
  { pattern: route(`/api/v1/chat/conversations/${ID}/read`), write: "message:read" },
  // Your starred and recent files (report C3, 0087): a star is your own shortcut, so reading is enough.
  { pattern: route(`/api/v1/workspaces/${ID}/files/${ID}/star`), write: "file:read", agent: "path" },
  { pattern: route(`/api/v1/workspaces/${ID}/files/mine`), read: "file:read", agent: "path" },
  // The workspace Trash (report C3); restoring goes through file-operation.
  { pattern: route(`/api/v1/workspaces/${ID}/files/trash`), read: "file:read", agent: "path" },
  // Search beyond files: tasks, comments, docs, people (report C2); the route applies the Tasks tab's read rules.
  { pattern: route(`/api/v1/workspaces/${ID}/search`), read: "task:read", agent: "path" },
  // Agents asking people (report §20.4); the routes check the workspace and who may answer.
  { pattern: route("/api/v1/questions"), read: "task:read", write: "task:write", agent: "route" },
  { pattern: route(`/api/v1/questions/${ID}`), read: "task:read", agent: "route" },
  { pattern: route(`/api/v1/questions/${ID}/(answer|mute)`), write: "task:write", agent: "route" },
  // The agent disconnected: send its held notifications (report A11.6).
  { pattern: route("/api/v1/agent-sessions/end"), write: null, agent: "self" },
  // Assignments and reviews (report A8.4–A8.5). Agents may read a copy in their workspace; handing in, asking the
  // class and reviewing are the person's own acts, so agent tokens can't call them.
  { pattern: route("/api/v1/assignments"), read: "task:read", agent: "self" },
  { pattern: route(`/api/v1/assignments/${ID}`), read: "task:read", agent: "route" },
  { pattern: route(`/api/v1/assignments/${ID}/hand-in`), write: "assignment:hand-in" },
  { pattern: route(`/api/v1/assignments/${ID}/question`), write: "task:write" },
  { pattern: route("/api/v1/reviews"), read: "task:read" },
  // A class's progress (report F1): the teacher's roster, read-only, people only (no agent rule).
  { pattern: route("/api/v1/reviews/progress"), read: "task:read" },
  { pattern: route(`/api/v1/reviews/${ID}`), write: "task:review" },
  // The hosted MCP server (P6.1): agent tokens only (the route checks); each tool calls the routes above.
  { pattern: route("/api/mcp"), write: "workspace:read", agent: "self" },
  // Your inbox and live changes (report A11.1–A11.2). Agents get file changes in their workspace, never the inbox.
  { pattern: route("/api/v1/inbox"), read: "workspace:read" },
  { pattern: route("/api/v1/inbox/read"), write: "workspace:read" },
  { pattern: route("/api/v1/events"), read: "workspace:read", agent: "route" },
  // Your devices, agents and personal tokens (report A3.9). No agent mode: agent tokens can't see or revoke them.
  { pattern: route("/api/v1/tokens"), read: null },
  { pattern: route(`/api/v1/tokens/${ID}/revoke`), write: null },
  // Your agents' activity, and pausing them (report F4). No agent mode: agents can't read or switch this; the route
  // also refuses personal access tokens for the switch (only the person's own sign-in, or the app).
  { pattern: route(`/api/v1/(workspaces|projects)/${ID}/agents`), read: "workspace:read", write: "task:write" },
  // Undo a change made with this person's token (report A2.9); the route checks the workspace.
  { pattern: route(`/api/v1/undo/${ID}`), read: null, write: null, agent: "route" },
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
/** The workspace a request names in its path or query, for routes whose rule says where (`agent: "path" | "query"`). */
export function workspaceRefInRequest(target: string | null): string | null {
  if (!target) return null;
  const mode = tokenRouteRule(target)?.agent;
  return mode === "path" || mode === "query" ? workspaceInRequest(mode, target) : null;
}

function workspaceInRequest(mode: "path" | "query", target: string): string | null {
  const [pathname = "", search = ""] = target.split("?");
  if (mode === "path") return /\/api\/v1\/(?:workspaces|projects)\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const params = new URLSearchParams(search);
  return params.get("projectId") ?? params.get("workspaceId");
}

/** Decide whether a token request may proceed. `method`/`path` come from the proxy's trusted headers. */
export function checkTokenAccess(input: { method: string | null; path: string | null; scopes: Set<TokenScope>; workspaceId?: string | null; allWorkspacesAgent?: boolean }): TokenAccessDenial | null {
  if (!input.method || !input.path) {
    return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  }
  const needed = tokenRouteScope(input.method, input.path);
  if (needed === "forbidden") return { status: 403, errorCode: "FORBIDDEN", message: "This needs a browser session" };
  if (needed && !input.scopes.has(needed)) {
    return { status: 403, errorCode: "SCOPE_MISSING", message: `This token can't do that: it needs the ${needed} permission`, scope: needed };
  }
  // Agents (one workspace or all) only use routes whose rule says how they find the workspace (report A5).
  if (input.allWorkspacesAgent && !tokenRouteRule(input.path)?.agent) {
    return { status: 403, errorCode: "WORKSPACE_NOT_ALLOWED", message: "AI agents can’t use this" };
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
