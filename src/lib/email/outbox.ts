import { db } from "@/lib/db";
import { emailOutbox } from "@/lib/db/schema";
import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";
import { assignmentRecipient, emailEnabled, emailEventKey, type EmailKind } from "./contracts";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function queueEmail(tx: Executor, input: {
  kind: EmailKind; eventId: string; userId: string; actorId?: string; taskId?: string; projectId?: string;
}) {
  if (!emailEnabled()) return;
  if (input.kind === "task_assignment" && !assignmentRecipient(input.actorId!, input.userId)) return;
  await tx.insert(emailOutbox).values({
    eventKey: emailEventKey(input.kind, input.eventId, input.userId),
    kind: input.kind, userId: input.userId, actorId: input.actorId,
    taskId: input.taskId, projectId: input.projectId,
  }).onConflictDoNothing({ target: emailOutbox.eventKey });
}

/** A wake-up is only a hint: committed work survives an unavailable Inngest API. */
export async function wakeEmailWorker() {
  if (!emailEnabled()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      inngest.send({ name: "email/outbox.wake", data: {} }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("wake_timeout")), 1_000);
      }),
    ]);
  } catch {
    logger.warn("email.wake_failed", { module: "email", reason: "recovery_scan_will_retry" });
  } finally { clearTimeout(timer); }
}
