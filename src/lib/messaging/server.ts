import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAuthUser } from "@/lib/supabase/auth-user";

export type ChatFailure = { success: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_ERROR = /^chat_[a-z_]+$/;

export const unauthorized: ChatFailure = { success: false, error: "chat_unauthorized" };
export const invalidInput: ChatFailure = { success: false, error: "chat_invalid_input" };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The signed-in user, or null. Every chat action starts here. */
export async function requireChatUser() {
  return getAuthUser();
}

/**
 * Map a database error to a stable code. The chat SQL functions raise
 * 42501/22023 with a `chat_*` message; anything else is logged and hidden.
 */
/** No error code that leaves the server says "blocked" (B31). */
export function neutralChatCode(code: string) {
  return code === "chat_blocked" ? "chat_cannot_reply" : code;
}

export function chatFailure(error: unknown, action: string): ChatFailure {
  // Drizzle wraps driver errors; the Postgres code and message live on `cause`.
  const source = (error as { cause?: unknown } | null)?.cause ?? error;
  const code = (source as { code?: string } | null)?.code;
  const message = source instanceof Error ? source.message : String(source);
  // The database's block refusal leaves the server under a neutral code (B31, K28).
  if ((code === "42501" || code === "22023") && KNOWN_ERROR.test(message)) return { success: false, error: neutralChatCode(message) };
  if (code === "23505") return { success: false, error: "chat_duplicate" };
  logger.error("chat.action_failed", { module: "chat", action, error: message });
  return { success: false, error: "chat_unavailable" };
}

export async function chatRows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

export async function chatValue<T>(query: SQL): Promise<T> {
  const [row] = await chatRows<{ value: T }>(query);
  return row?.value as T;
}

/** A validated uuid[] parameter (drizzle would otherwise expand a JS array into a list). */
export function uuidArray(ids: readonly string[]) {
  const safe = ids.filter(isUuid);
  return sql`${`{${safe.join(",")}}`}::uuid[]`;
}

/** JSON as an explicit text parameter, so no driver re-encodes it when Postgres infers jsonb. */
export function jsonParam(value: unknown) {
  return sql`${JSON.stringify(value)}::text::jsonb`;
}
