import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "INTERNAL_ERROR"
  | "CURRENT_PASSWORD_INVALID"
  | "LEAKED_PASSWORD"
  | "PASSWORD_SAFETY_UNAVAILABLE"
  | "PASSWORD_CHANGE_FAILED"
  | "SESSION_REVOKE_FAILED"
  | "STEP_UP_REQUIRED"
  | "STEP_UP_INVALID"
  | "RECOVERY_CODE_INVALID"
  | "EMAIL_NOT_CONFIRMED"
  | "DB_ERROR"
  | "DB_UNAVAILABLE"
  | "READINESS_DEGRADED"
  | "UNAVAILABLE"
  | "FILE_LOCKED"
  | "SCOPE_MISSING"
  | "VERSION_CONFLICT"
  | "SECRET_DETECTED"
  | "EXPIRED"
  | "WORKSPACE_NOT_ALLOWED"
  | "NEEDS_CONFIRMATION"
  | "AGENTS_PAUSED"
  | "AGENT_NOT_ALLOWED"
  | "TASK_CHANGED";

export function jsonSuccess<T>(
  data?: T,
  message?: string,
  init?: { status?: number; headers?: HeadersInit },
) {
  return NextResponse.json(
    {
      success: true as const,
      ...(data !== undefined ? { data } : {}),
      ...(message ? { message } : {}),
    },
    {
      status: init?.status ?? 200,
      headers: init?.headers,
    },
  );
}

export function jsonError(
  message: string,
  status: number,
  errorCode: ApiErrorCode,
  details?: unknown,
) {
  return NextResponse.json(
    {
      success: false as const,
      message,
      errorCode,
      ...(details !== undefined ? { details } : {}),
    },
    // Error envelopes are per-viewer and transient; no cache may keep one.
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
