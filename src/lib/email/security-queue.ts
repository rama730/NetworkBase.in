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
export async function queueSecurityEmail(to: string | { toEmail: string }, kind: SecurityEmailKind, data: SecurityEmailData = {}, eventId: string = randomUUID()) {
  try {
    // A person with an account goes by id; the "account deleted" note goes to the address kept on the deletion record.
    await queueEmail(db, { kind, eventId, ...(typeof to === "string" ? { userId: to, data: { ...data, at: data.at ?? new Date().toISOString() } } : { toEmail: to.toEmail }) });
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("email.security_queue_failed", { module: "email", kind, error: error instanceof Error ? error.message : String(error) });
  }
}
