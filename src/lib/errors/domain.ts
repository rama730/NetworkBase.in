/**
 * Typed domain errors (API-005). A thrown DomainError carries a safe, user-facing message and an
 * HTTP meaning; anything else is an internal failure whose text must never reach a client. Messages
 * are unchanged from the plain Errors they replace, so callers that read `.message` keep working.
 */
export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly errorCode = "FORBIDDEN" as const;
  constructor(message = "You don’t have access to this") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404 as const;
  readonly errorCode = "NOT_FOUND" as const;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409 as const;
  readonly errorCode = "CONFLICT" as const;
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

export type DomainError = ForbiddenError | NotFoundError | ConflictError;

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof ForbiddenError || error instanceof NotFoundError || error instanceof ConflictError;
}
