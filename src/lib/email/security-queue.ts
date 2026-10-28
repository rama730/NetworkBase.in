import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { SecurityEmailKind } from "./contracts";
import type { SecurityEmailData } from "./security-templates";
import { queueEmail, wakeEmailWorker } from "./outbox";

/**
 * Queues an account-security email. The action that caused it has already happened, so this never throws: a
 * failure to queue is logged and the person's request still succeeds. `eventId` makes a replay a no-op (the
 * reminders pass one per deletion and day-count; everything else gets a fresh id).
 */
export async function queueSecurityEmail(userId: string, kind: SecurityEmailKind, data: SecurityEmailData = {}, eventId: string = randomUUID()) {
  try {
    await queueEmail(db, { kind, eventId, userId, data: { ...data, at: data.at ?? new Date().toISOString() } });
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("email.security_queue_failed", { module: "email", kind, error: error instanceof Error ? error.message : String(error) });
  }
}
