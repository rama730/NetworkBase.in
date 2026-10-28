import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { SecurityEmailKind } from "./contracts";
import type { SecurityEmailData } from "./security-templates";
import { queueEmail, wakeEmailWorker } from "./outbox";

/** The confirmation that an account is gone goes to the address kept on the deletion record: there is no account left to look up. */
export async function queueDeletionCompletedEmail(email: string, deletionId: string) {
  try {
    await queueEmail(db, { kind: "account_deletion_completed", eventId: deletionId, toEmail: email });
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("email.deletion_completed_queue_failed", { module: "email", error: error instanceof Error ? error.message : String(error) });
  }
}

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
