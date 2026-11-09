// One error type for the CLI and one table from error codes to exit codes (report A4.9, A2.6).

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  auth: 3,
  conflict: 4,
  blocked: 5,
  needsInput: 6,
  needsConfirmation: 7,
  offline: 8,
  cancelled: 130,
};

/** Server and CLI error codes → exit code. Anything unlisted is a plain error (1). */
const EXIT_BY_CODE = {
  USAGE: EXIT.usage,
  UNKNOWN_COMMAND: EXIT.usage,
  UNKNOWN_FLAG: EXIT.usage,
  UNAUTHORIZED: EXIT.auth,
  NOT_SIGNED_IN: EXIT.auth,
  FORBIDDEN: EXIT.auth,
  SCOPE_MISSING: EXIT.auth,
  WORKSPACE_NOT_ALLOWED: EXIT.auth,
  AGENTS_PAUSED: EXIT.auth,
  STEP_UP_REQUIRED: EXIT.auth,
  NOT_LINKED: EXIT.auth,
  CONFLICT: EXIT.conflict,
  VERSION_CONFLICT: EXIT.conflict,
  LOCAL_CONFLICT: EXIT.conflict,
  TASK_CHANGED: EXIT.conflict,
  FILE_LOCKED: EXIT.conflict,
  SECRET_DETECTED: EXIT.blocked,
  PLAN_LIMIT_FILE_SIZE: EXIT.blocked,
  READ_ONLY: EXIT.blocked,
  NEEDS_INPUT: EXIT.needsInput,
  NEEDS_CONFIRMATION: EXIT.needsConfirmation,
  OFFLINE: EXIT.offline,
  CANCELLED: EXIT.cancelled,
};

export class CliError extends Error {
  /**
   * @param {string} code machine code (server `errorCode` or CLI code)
   * @param {string} message what happened, in plain words
   * @param {{ hint?: string, details?: unknown, status?: number, cause?: unknown }} [extra] hint = the next command to run
   */
  constructor(code, message, extra = {}) {
    super(message, extra.cause ? { cause: extra.cause } : undefined);
    this.name = "CliError";
    this.code = code;
    this.hint = extra.hint;
    this.details = extra.details;
    this.status = extra.status;
  }

  get exitCode() {
    return /** @type {Record<string, number>} */ (EXIT_BY_CODE)[this.code] ?? EXIT.error;
  }
}

/** @param {string} message @param {string} [hint] */
export const usage = (message, hint) => new CliError("USAGE", message, { hint });

/** @param {unknown} error */
export function toCliError(error) {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliError("INTERNAL", message || "Something went wrong", { cause: error });
}
