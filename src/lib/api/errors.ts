/**
 * The error codes a token client (CLI, agent, editor) can get from /api/v1 (report A2.6): what each means, what to
 * do, and the CLI exit code. Exported into openapi.json and the CLI schema; /docs/cli links each code here.
 */
export type ErrorEntry = { status: number; exit: number; meaning: string; fix: string };

export const ERROR_CATALOG: Record<string, ErrorEntry> = {
  BAD_REQUEST: { status: 400, exit: 1, meaning: "The request was malformed or a value was out of range", fix: "Check the command's flags; nb help <command>" },
  VALIDATION: { status: 400, exit: 1, meaning: "A value didn't pass the server's checks", fix: "Fix the value named in the message" },
  UNAUTHORIZED: { status: 401, exit: 3, meaning: "No valid sign-in: missing, expired, revoked, or unused for 90 days", fix: "nb login" },
  FORBIDDEN: { status: 403, exit: 3, meaning: "You're signed in but can't do this here", fix: "Check you're a member of the workspace: nb whoami" },
  SCOPE_MISSING: { status: 403, exit: 3, meaning: "This token wasn't given that permission", fix: "Sign in again with nb login, or make a token with more access in Settings" },
  WORKSPACE_NOT_ALLOWED: { status: 403, exit: 3, meaning: "An agent token only reaches the workspace it was approved for", fix: "Use the folder linked to that workspace, or approve a new agent sign-in" },
  AGENTS_PAUSED: { status: 403, exit: 3, meaning: "Agents are paused in this workspace", fix: "Turn agents back on in workspace settings" },
  STEP_UP_REQUIRED: { status: 403, exit: 3, meaning: "This needs a fresh sign-in check", fix: "Confirm it in the browser, then try again" },
  NOT_FOUND: { status: 404, exit: 1, meaning: "No such workspace, task or file, or you can't see it", fix: "Check the number or path: nb task list, nb file list" },
  EXPIRED: { status: 410, exit: 1, meaning: "It's gone: undone already, older than 24 hours, or a code ran out", fix: "Start again" },
  CONFLICT: { status: 409, exit: 4, meaning: "Someone changed it first, or it's in a state that doesn't allow this", fix: "Look at it again, then retry" },
  VERSION_CONFLICT: { status: 409, exit: 4, meaning: "A newer version was pushed since your pull", fix: "nb pull, then push again, or nb resolve <path>" },
  TASK_CHANGED: { status: 409, exit: 4, meaning: "The task changed since you read it", fix: "nb task view <n>, then retry" },
  FILE_LOCKED: { status: 423, exit: 4, meaning: "Someone is editing this file in an editor", fix: "Wait for them to finish, or ask them" },
  CLIENT_TOO_OLD: { status: 426, exit: 1, meaning: "This version of nb is too old for the server", fix: "npm i -g @networkbase/cli@latest" },
  NEEDS_CONFIRMATION: { status: 428, exit: 7, meaning: "An agent's big change waits for the person's yes", fix: "Show the summary; on a yes, send the same request with the confirm token (--confirm)" },
  SECRET_DETECTED: { status: 422, exit: 5, meaning: "A file looks like it holds a password or key", fix: "Remove it, or push with --confirm-secrets if it's safe (agents can't)" },
  CONTENT_MISMATCH: { status: 422, exit: 1, meaning: "The bytes that arrived don't match their hash", fix: "Run the command again" },
  CONTENT_HASH_MISMATCH: { status: 422, exit: 1, meaning: "The bytes that arrived don't match their hash", fix: "Run the command again" },
  RATE_LIMITED: { status: 429, exit: 1, meaning: "Too many requests from this token", fix: "Wait for the time in Retry-After" },
  NOT_SUPPORTED: { status: 501, exit: 1, meaning: "The server doesn't do this yet", fix: "Use the app for now" },
  UNAVAILABLE: { status: 503, exit: 1, meaning: "A service the server needs is down", fix: "Try again in a minute" },
  INTERNAL_ERROR: { status: 500, exit: 1, meaning: "Something broke on the server", fix: "Try again; if it keeps happening, nb feedback" },
};
